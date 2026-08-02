const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

const PROVIDER_ID = "mssql-localdb";
const SERVER_LABEL = "MSSQL LocalDB";
const CLAUDE_SERVER_NAME = "mssql-localdb";
const CONFIG_SECTION = "mssqlLocaldbMcp";
const BUNDLED_SERVER = path.join("server", "mssql-localdb-mcp.exe");
const CLAUDE_CONSENT_KEY = `${CONFIG_SECTION}.claudeCode.consent`;

// Output channel, created on activation: the registration below runs on its own
// and would otherwise be invisible when it decides to do nothing.
let log;

const CONFIG_TEMPLATE = `# Configuration for mssql-localdb-mcp.
#
# Windows paths in TOML need single quotes (literal string) — double
# quotes interpret \\U... as a unicode escape and break parsing.
#
# db_scan_folder refuses to run until at least one root is allowed here.
scan_allowlist = []

scan_max_depth = 6
default_query_timeout_secs = 30
default_max_rows = 1000
`;

function expandEnv(value) {
    return value.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match);
}

function resolveServerPath(context) {
    const configured = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get("serverPath", "")
        .trim();

    return configured
        ? path.normalize(expandEnv(configured))
        : context.asAbsolutePath(BUNDLED_SERVER);
}

function serverEnv() {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
        MSSQL_LOCALDB_MCP_LOG_LEVEL: config.get("logLevel", "info"),
        MSSQL_LOCALDB_MCP_QUERY_TIMEOUT_SECS: String(config.get("queryTimeoutSeconds", 30)),
        MSSQL_LOCALDB_MCP_DEFAULT_MAX_ROWS: String(config.get("maxRows", 1000)),
    };
}

function configFilePath() {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "mssql-localdb-mcp", "config.toml");
}

async function openConfig() {
    const file = configFilePath();
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, CONFIG_TEMPLATE, "utf8");
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document);
}

// The MCP provider API only registers the server inside VS Code — the Claude
// Code CLI keeps its own config and can't see it. It can, however, reuse the
// binary this extension already installed.
//
// This is not a one-shot install step: VS Code offers extensions no install
// hook, and the path recorded in the CLI lives inside the versioned extension
// folder, so every update moves it. The check therefore runs on activation,
// reads the entry the CLI holds, and writes when it is missing or stale.
//
// What the CLI holds says nothing about consent, though — that answer lives in
// globalState and nowhere else, so the prompt still shows on the first run of a
// machine whose config already names this server.

// The CLI's user-scope config, honouring a redirected CLAUDE_CONFIG_DIR.
function claudeConfigPath() {
    const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || os.homedir();
    return path.join(dir, ".claude.json");
}

// What the CLI currently holds for us — read only: every write goes through
// `claude mcp`, so we never risk mangling another product's config file.
function readClaudeRegistration() {
    try {
        const config = JSON.parse(fs.readFileSync(claudeConfigPath(), "utf8"));
        return config.mcpServers?.[CLAUDE_SERVER_NAME] ?? null;
    } catch {
        return null; // No config yet, or a shape we don't understand: treat as unregistered.
    }
}

function samePath(left, right) {
    if (!left || !right) {
        return false;
    }
    const normalize = (value) => {
        const full = path.resolve(value).replace(/[\\/]+$/, "");
        return process.platform === "win32" ? full.toLowerCase() : full;
    };
    return normalize(left) === normalize(right);
}

// true when the CLI already launches THIS binary with THESE settings — the
// settings included, so changing the log level or row cap reaches the CLI too.
function isCurrentRegistration(entry, exe, env) {
    if (!samePath(entry.command ?? "", exe)) {
        return false;
    }
    const registered = entry.env ?? {};
    return Object.entries(env).every(([name, value]) => registered[name] === value);
}

// Quote a shell argument; trailing separators are already gone, so `"C:\dir\"`
// can't swallow the closing quote.
function quote(value) {
    return /[\s"'&|<>^()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function buildAddCommand(cli, exe, env) {
    const vars = Object.entries(env)
        .map(([name, value]) => `-e ${quote(`${name}=${value}`)}`)
        .join(" ");
    return `${quote(cli)} mcp add ${CLAUDE_SERVER_NAME} --scope user ${vars} -- ${quote(exe)}`;
}

function runCommand(command, timeout = 30000) {
    return new Promise((resolve, reject) => {
        cp.exec(command, { windowsHide: true, timeout }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error((stderr || error.message).trim()));
            } else {
                resolve(stdout);
            }
        });
    });
}

// PATH first — that is the supported install — then the standard locations: the
// window's PATH is the one it inherited at startup, and misses a CLI installed
// afterwards or one the native installer never exported.
async function locateClaudeCli() {
    for (const candidate of ["claude", ...knownClaudeCliPaths()]) {
        try {
            await runCommand(`${quote(candidate)} --version`, 10000);
            return candidate;
        } catch {
            // Not this one; keep looking.
        }
    }
    return null;
}

function knownClaudeCliPaths() {
    const home = os.homedir();
    const candidates = [
        path.join(home, ".local", "bin", "claude.exe"),
        path.join(home, ".local", "bin", "claude"),
    ];
    if (process.env.APPDATA) {
        candidates.push(path.join(process.env.APPDATA, "npm", "claude.cmd"));
    }
    if (process.env.ProgramFiles) {
        candidates.push(path.join(process.env.ProgramFiles, "nodejs", "claude.cmd"));
    }
    return candidates.filter((candidate) => fs.existsSync(candidate));
}

async function applyClaudeRegistration(cli, exe, env, current, announce) {
    const command = buildAddCommand(cli, exe, env);

    try {
        // `mcp add` refuses to overwrite an existing name, so any entry has to go
        // first — otherwise an update would leave the CLI on a deleted folder.
        if (current) {
            log.info(isCurrentRegistration(current, exe, env)
                ? `Rewriting the "${CLAUDE_SERVER_NAME}" registration — the CLI refuses to overwrite a name.`
                : `Replacing the outdated "${CLAUDE_SERVER_NAME}" registration.`);
            await runCommand(`${quote(cli)} mcp remove ${CLAUDE_SERVER_NAME} --scope user`);
        }

        log.info(`Registering with the Claude Code CLI: ${command}`);
        const output = await runCommand(command);
        log.info(output.trim() || `Registered "${CLAUDE_SERVER_NAME}" in the Claude Code CLI.`);

        if (announce) {
            vscode.window.showInformationMessage(
                `Registered as "${CLAUDE_SERVER_NAME}" in the Claude Code CLI (user scope).`,
            );
        }
    } catch (error) {
        log.error(`Claude Code CLI registration failed: ${error.message}`);
        await offerCommand(`Claude Code CLI registration failed: ${error.message}`, command);
    }
}

// Error notification that hands the exact command over instead of a dead end.
async function offerCommand(message, command) {
    const copyAction = "Copy command";
    const choice = await vscode.window.showErrorMessage(message, copyAction, "Show Log");
    if (choice === copyAction) {
        await vscode.env.clipboard.writeText(command);
    } else if (choice) {
        log.show();
    }
}

// Asked once. Dismissing answers nothing and the question returns on the next
// activation; "Never" is remembered and the palette command is the way back.
async function askClaudeConsent(context) {
    const yes = "Register";
    const never = "Never";
    const choice = await vscode.window.showInformationMessage(
        "MSSQL LocalDB MCP: the Claude Code CLI is installed. Register this server so `claude` can drive LocalDB?",
        yes,
        "Not now",
        never,
    );

    if (choice === yes) {
        await context.globalState.update(CLAUDE_CONSENT_KEY, "granted");
        return true;
    }
    if (choice === never) {
        await context.globalState.update(CLAUDE_CONSENT_KEY, "never");
        log.info("Claude Code CLI registration declined permanently (run the command from the palette to undo).");
    }
    return false;
}

// Activation hook — the closest thing to "register on install". Costs one file
// read once the answer is on record and the entry matches; the CLI is probed
// only when there is something to ask or to write.
async function autoRegisterWithClaudeCode(context) {
    if (process.platform !== "win32") {
        return; // LocalDB is Windows-only, and so is the bundled binary.
    }

    const consent = context.globalState.get(CLAUDE_CONSENT_KEY);
    if (consent === "never") {
        return;
    }

    const exe = resolveServerPath(context);
    if (!fs.existsSync(exe)) {
        log.error(`Server binary not found at ${exe} — skipping the Claude Code CLI registration.`);
        return;
    }

    const env = serverEnv();
    const current = readClaudeRegistration();

    // Only an answered prompt closes the question. An entry in the CLI config we
    // never wrote — added by hand, or by an agent — is not consent: treating it
    // as one kept the prompt from ever appearing on a machine where the server
    // happened to be registered before the extension was installed.
    if (consent === "granted" && current && isCurrentRegistration(current, exe, env)) {
        log.info(`Claude Code CLI: "${CLAUDE_SERVER_NAME}" already registered for this build.`);
        return;
    }

    const cli = await locateClaudeCli();
    if (!cli) {
        log.info("Claude Code CLI not found — skipping the CLI registration.");
        return;
    }

    // A stale entry with the answer on record means an update moved the binary,
    // not a new install: the user agreed once, so repair it without asking again.
    const asking = consent !== "granted";
    if (asking) {
        if (current) {
            log.info(`Claude Code CLI already holds a "${CLAUDE_SERVER_NAME}" entry this extension did not write — asking before taking it over.`);
        }
        if (!(await askClaudeConsent(context))) {
            return;
        }
    }

    await applyClaudeRegistration(cli, exe, env, current, asking);
}

// Palette command: registers unconditionally and counts as consent, which is
// also how someone who answered "Never" gets back.
async function registerWithClaudeCode(context) {
    const exe = resolveServerPath(context);
    if (!fs.existsSync(exe)) {
        vscode.window.showErrorMessage(`MSSQL LocalDB MCP: server binary not found at ${exe}.`);
        return;
    }

    const env = serverEnv();
    const cli = await locateClaudeCli();
    if (!cli) {
        log.error("Claude Code CLI not found (tried PATH and the standard install locations).");
        await offerCommand(
            "MSSQL LocalDB MCP: the Claude Code CLI was not found. Install it, or run the command yourself in a terminal where `claude` works.",
            buildAddCommand("claude", exe, env),
        );
        return;
    }

    await context.globalState.update(CLAUDE_CONSENT_KEY, "granted");
    await applyClaudeRegistration(cli, exe, env, readClaudeRegistration(), true);
}

function activate(context) {
    log = vscode.window.createOutputChannel("MSSQL LocalDB MCP", { log: true });

    context.subscriptions.push(
        log,
        vscode.commands.registerCommand(`${CONFIG_SECTION}.openConfig`, openConfig),
        vscode.commands.registerCommand(`${CONFIG_SECTION}.registerWithClaudeCode`, () =>
            registerWithClaudeCode(context),
        ),
        vscode.commands.registerCommand(`${CONFIG_SECTION}.showServerPath`, () => {
            const exe = resolveServerPath(context);
            const state = fs.existsSync(exe) ? "found" : "MISSING";
            vscode.window.showInformationMessage(`mssql-localdb-mcp (${state}): ${exe}`);
        }),
    );

    // Before the API check below: the CLI registration is independent of it, and
    // is exactly what an editor too old for `lm` still benefits from.
    void autoRegisterWithClaudeCode(context);

    if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") {
        return;
    }

    const didChangeEmitter = new vscode.EventEmitter();
    context.subscriptions.push(
        didChangeEmitter,
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                didChangeEmitter.fire();
            }
        }),
        vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
            onDidChangeMcpServerDefinitions: didChangeEmitter.event,
            provideMcpServerDefinitions() {
                if (process.platform !== "win32") {
                    return [];
                }

                const exe = resolveServerPath(context);
                if (!fs.existsSync(exe)) {
                    vscode.window.showErrorMessage(
                        `MSSQL LocalDB MCP: server binary not found at ${exe}. ` +
                            "Set mssqlLocaldbMcp.serverPath or reinstall the extension.",
                    );
                    return [];
                }

                return [
                    new vscode.McpStdioServerDefinition(
                        SERVER_LABEL,
                        exe,
                        [],
                        serverEnv(),
                        context.extension.packageJSON.version,
                    ),
                ];
            },
            resolveMcpServerDefinition(server) {
                return server;
            },
        }),
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
