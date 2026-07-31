# MSSQL LocalDB MCP

Gives GitHub Copilot Chat (agent mode) — and any MCP consumer inside VS Code — full access to **SQL Server Express LocalDB** on Windows: manage instances, run any T-SQL script, discover loose `.mdf`/`.ldf` files in your project folders, and introspect schema.

The MCP server is a single native Rust binary bundled with the extension — no Python, .NET or Node runtime, no Docker, no download on first run.

## Requirements

- **Windows** with SQL Server Express LocalDB installed (`SqlLocalDB.exe` on `PATH`). LocalDB ships with Visual Studio and the SQL Server Express installer.
- VS Code 1.101 or later (MCP support).

## Usage

After install, the server is registered automatically and shows up under **MCP: List Servers** as `MSSQL LocalDB`. Open Copilot Chat in agent mode and the `localdb_*`, `sql_*` and `db_*` tools are available — for example:

> List my LocalDB instances and show the tables in the `AppDb` database.

Folder discovery (`db_scan_folder`) is allowlist-restricted and refuses to run until you allow at least one root. Run **MSSQL LocalDB MCP: Open config.toml** from the Command Palette and fill in:

```toml
# Windows paths in TOML need single quotes (literal string).
scan_allowlist = ['C:\Users\YourUser\source\repos']
scan_max_depth = 6
```

## Claude Code CLI

VS Code registers MCP servers in-process, so the Claude Code CLI (in the terminal, or in the VS Code panel) does **not** inherit this extension's server — it reads its own config. Run **MSSQL LocalDB MCP: Register with Claude Code CLI** from the Command Palette to register it there too, reusing the binary already installed by the extension:

```powershell
claude mcp add mssql-localdb --scope user -- "<extension>\server\mssql-localdb-mcp.exe"
```

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `mssqlLocaldbMcp.serverPath` | *(empty)* | Path to a custom `mssql-localdb-mcp.exe`. Empty uses the bundled binary. |
| `mssqlLocaldbMcp.logLevel` | `info` | Server log level (stderr only). |
| `mssqlLocaldbMcp.queryTimeoutSeconds` | `30` | Default query timeout. |
| `mssqlLocaldbMcp.maxRows` | `1000` | Default row cap per query. |

## Security

- **Windows Integrated Authentication only** — no SQL Auth, no password field anywhere.
- Every destructive action (`DROP`, `TRUNCATE`, `DELETE`, `ALTER`, …) requires an explicit `confirm: true` — it never executes silently.
- `db_scan_folder` only reads folders explicitly allowed in `config.toml`.

Full threat model: [`docs/SECURITY.md`](https://github.com/hermessilva/LocalDB-MCP/blob/master/docs/SECURITY.md).

## Documentation

- [Repository](https://github.com/hermessilva/LocalDB-MCP)
- [Tool contract (`docs/MCP_SPEC.md`)](https://github.com/hermessilva/LocalDB-MCP/blob/master/docs/MCP_SPEC.md)
- [Architecture](https://github.com/hermessilva/LocalDB-MCP/blob/master/docs/ARCHITECTURE.md)
- [Issues](https://github.com/hermessilva/LocalDB-MCP/issues)

## License

[MIT](https://github.com/hermessilva/LocalDB-MCP/blob/master/LICENSE).
