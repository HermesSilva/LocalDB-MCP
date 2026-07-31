<#
.SYNOPSIS
  Builds the VS Code extension package (.vsix) with the Rust server binary
  bundled inside it.

.DESCRIPTION
  The Marketplace listing is platform-specific (win32-x64): LocalDB only
  exists on Windows, so publishing a universal package would offer the
  extension on machines where it can never work.

  The extension carries its own version line (vscode-extension/package.json),
  independent from Cargo.toml: the crate version is what the `vX.Y.Z` tag and
  the MCP Registry publish, while the Marketplace only requires each upload to
  be higher than the last. Every run bumps the build (third) segment.

.PARAMETER Version
  Exact version to package (x.y.z), instead of bumping the build segment.

.PARAMETER NoBump
  Packages the version currently in package.json, without incrementing it.

.PARAMETER SkipBuild
  Reuses the existing target/release binary instead of running cargo build.

.PARAMETER Publish
  Publishes the generated .vsix to the Marketplace after packaging.
  Requires a Personal Access Token (-Pat, or the VSCE_PAT env var).

.EXAMPLE
  ./build-vsix.ps1

.EXAMPLE
  ./build-vsix.ps1 -Version 1.1.0

.EXAMPLE
  ./build-vsix.ps1 -SkipBuild -Publish -Pat "<azure-devops-pat>"
#>
param(
    [string]$Version = "",
    [switch]$NoBump,
    [switch]$SkipBuild,
    [switch]$Publish,
    [string]$Pat = $env:VSCE_PAT
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

$extensionDir = Join-Path $root "vscode-extension"
$target = "win32-x64"

foreach ($tool in @("cargo", "npx")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found on PATH (npx requires Node.js)."
    }
}

# 1. Version: package.json holds it, the build segment moves on every run
$packageJsonPath = Join-Path $extensionDir "package.json"
$packageJson = (Get-Content $packageJsonPath -Raw).TrimStart([char]0xFEFF)
if ($packageJson -notmatch '(?m)^\s*"version":\s*"(\d+)\.(\d+)\.(\d+)"') {
    throw "could not read an x.y.z version from $packageJsonPath"
}
$major, $minor, $build = [int]$Matches[1], [int]$Matches[2], [int]$Matches[3]
$current = "$major.$minor.$build"

if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "-Version must be x.y.z, got '$Version'" }
}
elseif ($NoBump) {
    $Version = $current
}
else {
    $Version = "$major.$minor.$($build + 1)"
}

$packageJson = $packageJson -replace '(?m)^(\s*"version":\s*").*(",)$', "`${1}$Version`${2}"
# Set-Content -Encoding utf8 writes a BOM on Windows PowerShell 5.1, and vsce's
# JSON parser rejects it - write the bytes ourselves to stay edition-agnostic.
[System.IO.File]::WriteAllText($packageJsonPath, $packageJson, (New-Object System.Text.UTF8Encoding($false)))

$version = $Version
Write-Host "Packaging MSSQL LocalDB MCP v$version for $target ($current -> $version)..." -ForegroundColor Cyan

# 2. Server binary
if (-not $SkipBuild) {
    cargo build --release
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
}

$binary = Join-Path $root "target/release/mssql-localdb-mcp.exe"
if (-not (Test-Path $binary)) { throw "binary not found: $binary (run without -SkipBuild)" }

$serverDir = Join-Path $extensionDir "server"
New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
Copy-Item $binary (Join-Path $serverDir "mssql-localdb-mcp.exe") -Force

# 3. Package
Get-ChildItem (Join-Path $root "mssql-localdb-mcp-*.vsix") -ErrorAction SilentlyContinue | Remove-Item -Force
$vsixPath = Join-Path $root "mssql-localdb-mcp-$version-$target.vsix"

Push-Location $extensionDir
try {
    npx --yes '@vscode/vsce@latest' package --target $target --out $vsixPath
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed" }

    if ($Publish) {
        if (-not $Pat) { throw "publishing requires -Pat or the VSCE_PAT environment variable" }
        npx --yes '@vscode/vsce@latest' publish --packagePath $vsixPath --pat $Pat
        if ($LASTEXITCODE -ne 0) { throw "vsce publish failed" }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Package: $vsixPath" -ForegroundColor Green
Write-Host ""

if ($Publish) {
    Write-Host "Published to the Marketplace." -ForegroundColor Green
} else {
    Write-Host "Install locally to smoke test:" -ForegroundColor Yellow
    Write-Host "  code --install-extension `"$vsixPath`""
    Write-Host ""
    Write-Host "Then publish with:" -ForegroundColor Yellow
    Write-Host "  ./build-vsix.ps1 -SkipBuild -Publish -Pat <azure-devops-pat>"
}
