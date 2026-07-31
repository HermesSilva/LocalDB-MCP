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
async function registerWithClaudeCode(context) {
    const exe = resolveServerPath(context);
    if (!fs.existsSync(exe)) {
        vscode.window.showErrorMessage(`MSSQL LocalDB MCP: server binary not found at ${exe}.`);
        return;
    }

    const command = `claude mcp add ${CLAUDE_SERVER_NAME} --scope user -- "${exe}"`;

    try {
        await new Promise((resolve, reject) => {
            cp.exec(command, { windowsHide: true }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error((stderr || error.message).trim()));
                } else {
                    resolve(stdout);
                }
            });
        });
        vscode.window.showInformationMessage(
            `Registered as "${CLAUDE_SERVER_NAME}" in the Claude Code CLI (user scope).`,
        );
    } catch (error) {
        const copyAction = "Copy command";
        const choice = await vscode.window.showErrorMessage(
            `Claude Code CLI registration failed: ${error.message}`,
            copyAction,
        );
        if (choice === copyAction) {
            await vscode.env.clipboard.writeText(command);
        }
    }
}

function activate(context) {
    context.subscriptions.push(
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
