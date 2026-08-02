# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning [SemVer](https://semver.org/).

## [1.0.6] - 2026-07-31

### Fixed

- The registration prompt never appeared when the Claude Code CLI already had an `mssql-localdb`
  entry pointing at the bundled binary — added by hand or by an agent before the extension was
  installed. Activation short-circuited on that entry and returned "already registered" without
  ever asking, so the answer was never recorded and the user was never told anything happened.
  Consent now comes only from the prompt: an entry the extension did not write is taken over
  after the user agrees to it.

## [1.0.5] - 2026-07-30

### Added

- Registers itself with the Claude Code CLI on activation, instead of waiting for someone to
  remember the palette command: with the CLI installed and no `mssql-localdb` server in its
  config, the extension asks once (*Register* / *Not now* / *Never*) and keeps the answer.
- The registration repairs itself. The path handed to the CLI points inside the versioned
  extension folder, so every update silently invalidated it; each activation now compares the
  entry the CLI holds against the current binary and settings, and rewrites it when it drifted —
  no question asked, since consent was already given.
- The settings (`logLevel`, `queryTimeoutSeconds`, `maxRows`) reach the CLI as well. The
  in-editor server got them and the CLI one ran on the binary's defaults.
- Output channel **MSSQL LocalDB MCP** — the registration runs on its own and needs somewhere
  to explain what it decided.

### Fixed

- The CLI is looked up beyond `PATH` (native installer, npm global, `Program Files\nodejs`).
  A window inherits its `PATH` at startup, so a CLI installed afterwards was invisible and the
  registration failed with "'claude' is not recognized".
- Registering twice is no longer an error: `claude mcp add` refuses to overwrite a name, so a
  stale entry is removed first.

## [1.0.0] - 2026-07-30

### Added

- Registers `mssql-localdb-mcp` as an MCP server provider in VS Code, with the Windows binary bundled in the extension.
- Settings for server path override, log level, query timeout and row cap.
- Commands: **Open config.toml**, **Register with Claude Code CLI** and **Show Server Binary Path**.

The extension is versioned independently from the Rust server (`Cargo.toml`): the crate version is
what the `vX.Y.Z` tag and the MCP Registry publish, while `build-vsix.ps1` bumps the build segment
here on every packaging run.
