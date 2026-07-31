# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning [SemVer](https://semver.org/).

## [1.0.0] - 2026-07-30

### Added

- Registers `mssql-localdb-mcp` as an MCP server provider in VS Code, with the Windows binary bundled in the extension.
- Settings for server path override, log level, query timeout and row cap.
- Commands: **Open config.toml**, **Register with Claude Code CLI** and **Show Server Binary Path**.

The extension is versioned independently from the Rust server (`Cargo.toml`): the crate version is
what the `vX.Y.Z` tag and the MCP Registry publish, while `build-vsix.ps1` bumps the build segment
here on every packaging run.
