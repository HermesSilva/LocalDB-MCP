# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning [SemVer](https://semver.org/).

## [Unreleased]

### Added

- `vscode-extension/` — VS Code extension for the Marketplace: registers the server via the MCP provider API, bundles the Windows binary, exposes settings (server path, log level, query timeout, row cap) and commands to open `config.toml`, show the binary path, and register the server with the Claude Code CLI (which doesn't see VS Code's in-process MCP registration).
- `build-vsix.ps1` — builds and packages the platform-specific `.vsix` (`win32-x64`) at the repo root, bumping the extension's build segment on every run (`-Version x.y.z` / `-NoBump` to override), with optional Marketplace publish. The extension starts at `1.0.0` and is versioned independently from the crate.

## [0.1.0] - 2026-07-01

### Added

- Phase 1 skeleton (MVP): functional MCP server via `rmcp` (official SDK) + `tiberius` over a named pipe with Windows Integrated Authentication.
- LocalDB instance management: `localdb_list_instances`, `localdb_versions`, `localdb_info`, `localdb_create_instance`, `localdb_start_instance`, `localdb_stop_instance`, `localdb_delete_instance`.
- Script/SQL channel: `sql_execute_script`, `sql_execute_query`, `sql_execute_statement` — with a mandatory confirmation guard for destructive actions.
- Database discovery: `db_scan_folder` (allowlist-restricted), `db_attach`, `db_detach`, `db_list_tables`.
- Publishing infra: `server.json` (official MCP Registry), `mcpb/manifest.json` (Desktop Extension), CI (fmt/clippy/test/build), and an automated release workflow via GitHub OIDC.

[Unreleased]: https://github.com/hermessilva/LocalDB-MCP/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hermessilva/LocalDB-MCP/releases/tag/v0.1.0
