$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "[error] Node.js (>= 20.0.0) is required. Install it from https://nodejs.org."
    exit 1
}

$NodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($NodeMajor -lt 20) {
    Write-Error "[error] Node.js >= 20.0.0 is required (found $(node -v))."
    exit 1
}

$IsUninstall = $false
foreach ($arg in $args) {
    if ($arg -eq "--uninstall" -or $arg -eq "--help" -or $arg -eq "-h") {
        $IsUninstall = $true
    }
}

$TscPath = Join-Path $RootDir "node_modules\typescript\bin\tsc"
$PnpmTscPath = Join-Path $RootDir "node_modules\.pnpm\node_modules\typescript\bin\tsc"
if ((-not (Test-Path $TscPath)) -and (-not (Test-Path $PnpmTscPath))) {
    Write-Host "[setup] Installing build dependencies..."
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $IsUninstall) {
    node "$RootDir\scripts\build-all.mjs"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

node "$RootDir\scripts\install.mjs" @args
exit $LASTEXITCODE
