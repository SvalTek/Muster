#Requires -Version 5.1
<#
  Install Muster into a Herdr app home.

  Copies the themes, layout, mod and Bun service; creates the data folder;
  writes the mod's install record; merges the layout:muster keys with a
  timestamped backup; then runs `muster doctor` and `herdr-app check` when the
  tools are available.

  Examples:
    pwsh -File .\install.ps1
    pwsh -File .\install.ps1 -Compile
    pwsh -File .\install.ps1 -NoKeys
    pwsh -File .\install.ps1 -AppHome D:\herdr-app -MusterHome D:\muster-data
#>
[CmdletBinding()]
param(
  [string]$AppHome = "",
  [string]$MusterHome = "",
  [switch]$Compile,
  [switch]$NoKeys
)

$ErrorActionPreference = "Stop"

function Step([string]$text) {
  Write-Host "  $text"
}

function Fail([string]$text) {
  throw "muster install: $text"
}

function Copy-One([string]$from, [string]$to) {
  $parent = Split-Path -Parent $to
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Copy-Item -LiteralPath $from -Destination $to -Force
}

function Write-Json([string]$path, $value) {
  $json = $value | ConvertTo-Json -Depth 32
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($path, "$json`n", $encoding)
}

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $source) { $source = (Get-Location).Path }
$source = [IO.Path]::GetFullPath($source)

# --- Paths -----------------------------------------------------------------

if (-not $AppHome) { $AppHome = Join-Path $env:USERPROFILE ".config\herdr-app" }
$explicitHome = $PSBoundParameters.ContainsKey("MusterHome") -and $MusterHome
if (-not $MusterHome -and $env:MUSTER_HOME) { $MusterHome = $env:MUSTER_HOME }
if (-not $MusterHome) { $MusterHome = Join-Path $env:LOCALAPPDATA "Muster" }

$AppHome = [IO.Path]::GetFullPath($AppHome)
$MusterHome = [IO.Path]::GetFullPath($MusterHome)

$dbPath = ""
if (-not $explicitHome -and $env:MUSTER_DB) {
  $dbPath = [IO.Path]::GetFullPath($env:MUSTER_DB)
} else {
  $dbPath = Join-Path $MusterHome "muster.db"
}

$themeSource = Join-Path $source "themes"
$layoutSource = Join-Path $source "layouts\muster.json"
$modSource = Join-Path $source "mods\muster"
$serviceSource = Join-Path $source "service"
$keysSource = Join-Path $source "keys.json"
$cliSource = Join-Path $serviceSource "src\cli.ts"

foreach ($required in @(
    (Join-Path $themeSource "muster.json"),
    (Join-Path $themeSource "muster-day.json"),
    $layoutSource,
    (Join-Path $modSource "mod.json"),
    (Join-Path $modSource "main.js"),
    $cliSource,
    $keysSource
  )) {
  if (-not (Test-Path -LiteralPath $required)) { Fail "missing $required" }
  }

if (-not (Test-Path -LiteralPath $AppHome)) {
  Fail "no Herdr app home at $AppHome. Pass -AppHome or install Herdr first."
}

$package = Get-Content -LiteralPath (Join-Path $serviceSource "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version

Write-Host "Muster $version"
Write-Host "  app home   $AppHome"
Write-Host "  data       $MusterHome"
Write-Host ""

# --- Themes and layout -----------------------------------------------------

$themesTarget = Join-Path $AppHome "themes"
New-Item -ItemType Directory -Force -Path $themesTarget | Out-Null
foreach ($name in @("muster.json", "muster-day.json")) {
  Copy-One (Join-Path $themeSource $name) (Join-Path $themesTarget $name)
}
Step "themes -> $themesTarget"

$layoutsTarget = Join-Path $AppHome "layouts"
New-Item -ItemType Directory -Force -Path $layoutsTarget | Out-Null
Copy-One $layoutSource (Join-Path $layoutsTarget "muster.json")
Step "layout -> $layoutsTarget\muster.json"

# --- Mod -------------------------------------------------------------------

$modTarget = Join-Path $AppHome "mods\muster"
New-Item -ItemType Directory -Force -Path $modTarget | Out-Null
$modFiles = @(Get-ChildItem -LiteralPath $modSource -Filter *.js -File)
foreach ($file in $modFiles) {
  Copy-One $file.FullName (Join-Path $modTarget $file.Name)
}
$keep = @($modFiles | ForEach-Object { $_.Name })
Get-ChildItem -LiteralPath $modTarget -Filter *.js -File |
  Where-Object { $keep -notcontains $_.Name } |
  Remove-Item -Force
Copy-One (Join-Path $modSource "mod.json") (Join-Path $modTarget "mod.json")

$iconsSource = Join-Path $modSource "icons"
if (Test-Path -LiteralPath $iconsSource) {
  $iconsTarget = Join-Path $modTarget "icons"
  New-Item -ItemType Directory -Force -Path $iconsTarget | Out-Null
  Get-ChildItem -LiteralPath $iconsTarget -Filter *.svg -File -ErrorAction SilentlyContinue | Remove-Item -Force
  $iconFiles = @(Get-ChildItem -LiteralPath $iconsSource -Filter *.svg -File)
  foreach ($file in $iconFiles) {
    Copy-One $file.FullName (Join-Path $iconsTarget $file.Name)
  }
}
Step "mod -> $modTarget"

# --- Service ---------------------------------------------------------------

$serviceTarget = Join-Path $AppHome "service"
New-Item -ItemType Directory -Force -Path $serviceTarget | Out-Null
$srcTarget = Join-Path $serviceTarget "src"
if (Test-Path -LiteralPath $srcTarget) { Remove-Item -LiteralPath $srcTarget -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $serviceSource "src") -Destination $srcTarget -Recurse -Force
Copy-One (Join-Path $serviceSource "package.json") (Join-Path $serviceTarget "package.json")
if (Test-Path -LiteralPath (Join-Path $serviceSource "tsconfig.json")) {
  Copy-One (Join-Path $serviceSource "tsconfig.json") (Join-Path $serviceTarget "tsconfig.json")
}
$installedCli = Join-Path $srcTarget "cli.ts"
Step "service -> $serviceTarget"

# --- Data folder -----------------------------------------------------------

New-Item -ItemType Directory -Force -Path $MusterHome | Out-Null
$dbParent = Split-Path -Parent $dbPath
if ($dbParent) { New-Item -ItemType Directory -Force -Path $dbParent | Out-Null }
Step "data -> $MusterHome"

# --- Optional single-file build -------------------------------------------

$bun = Get-Command bun -ErrorAction SilentlyContinue
$command = "bun"
$prefix = @($installedCli)

if ($Compile) {
  if (-not $bun) {
    Fail "bun was not found on PATH. Install Bun (https://bun.sh) or run without -Compile."
  }
  $binTarget = Join-Path $AppHome "bin"
  New-Item -ItemType Directory -Force -Path $binTarget | Out-Null
  $exe = Join-Path $binTarget "muster.exe"
  $tmp = Join-Path $binTarget "muster.new.exe"
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  Write-Host "  building $exe"
  Push-Location $serviceTarget
  try {
    & $bun.Source build --compile --outfile $tmp "src/cli.ts"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmp)) {
      Fail "bun build --compile failed (exit $LASTEXITCODE)."
    }
    Move-Item -LiteralPath $tmp -Destination $exe -Force
  } catch {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    throw
  } finally {
    Pop-Location
  }
  $command = $exe
  $prefix = @()
  Step "compiled -> $exe"
} elseif (-not $bun) {
  Fail "bun was not found on PATH. Install Bun (https://bun.sh) or run with -Compile."
}

# --- The mod's install record ---------------------------------------------

$configPath = Join-Path $AppHome "muster.json"
$config = [ordered]@{
  command     = $command
  prefix      = @($prefix)
  db          = $dbPath
  version     = $version
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
Write-Json $configPath $config
$null = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
Step "record -> $configPath"

# --- Keys ------------------------------------------------------------------

$keysPath = Join-Path $AppHome "keys.json"
if ($NoKeys) {
  Step "keys unchanged (-NoKeys)"
} else {
  if (-not (Test-Path -LiteralPath $keysPath)) {
    Write-Json $keysPath ([ordered]@{ global = [ordered]@{} })
    Step "created $keysPath"
  }

  try {
    $keys = Get-Content -LiteralPath $keysPath -Raw | ConvertFrom-Json
  } catch {
    Fail "keys.json is not valid JSON: $($_.Exception.Message)"
  }
  if ($null -eq $keys) { $keys = [pscustomobject]@{} }

  $sourceKeys = (Get-Content -LiteralPath $keysSource -Raw | ConvertFrom-Json).'layout:muster'
  if (-not $sourceKeys) { Fail "keys.json in the package has no layout:muster section." }

  $existingProp = $keys.PSObject.Properties["layout:muster"]
  if ($existingProp) {
    $existing = $existingProp.Value
  } else {
    $existing = [pscustomobject]@{}
    $keys | Add-Member -MemberType NoteProperty -Name "layout:muster" -Value $existing
  }

  $changed = -not $existingProp
  $kept = @()
  foreach ($binding in $sourceKeys.PSObject.Properties) {
    $current = $existing.PSObject.Properties[$binding.Name]
    if (-not $current) {
      $existing | Add-Member -MemberType NoteProperty -Name $binding.Name -Value $binding.Value
      $changed = $true
    } elseif ([string]$current.Value -ne [string]$binding.Value) {
      $kept += "$($binding.Name) = $($current.Value)"
    }
  }

  if ($changed) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backup = "$keysPath.bak-$stamp"
    $n = 1
    while (Test-Path -LiteralPath $backup) {
      $backup = "$keysPath.bak-$stamp-$n"
      $n++
    }
    Copy-Item -LiteralPath $keysPath -Destination $backup -Force
    Write-Json $keysPath $keys
    $null = Get-Content -LiteralPath $keysPath -Raw | ConvertFrom-Json
    Step "keys -> layout:muster merged (backup: $(Split-Path -Leaf $backup))"
  } else {
    Step "keys -> layout:muster already complete"
  }
  foreach ($line in $kept) { Write-Host "  kept existing binding: $line" }
}

# --- Doctor and mod check --------------------------------------------------

$env:MUSTER_HOME = $MusterHome
$env:MUSTER_DB = $dbPath

Write-Host ""
Write-Host "Doctor"
$doctorFailed = $false
try {
  if ($Compile) {
    & $command doctor --db $dbPath
  } else {
    & $bun.Source $installedCli doctor --db $dbPath
  }
  if ($LASTEXITCODE -ne 0) { $doctorFailed = $true }
} catch {
  $doctorFailed = $true
  Write-Warning "doctor failed: $($_.Exception.Message)"
}
if ($doctorFailed) { Write-Warning "muster doctor reported a problem; see the lines above." }

$herdrExe = $null
$herdrCommand = Get-Command herdr-app -ErrorAction SilentlyContinue
if ($herdrCommand) {
  $herdrExe = $herdrCommand.Source
} else {
  $candidate = Join-Path $env:LOCALAPPDATA "Programs\herdr-app\herdr-app.exe"
  if (Test-Path -LiteralPath $candidate) { $herdrExe = $candidate }
}

$checkFailed = $false
if ($herdrExe) {
  Write-Host ""
  Write-Host "Mod check"
  $previousAppHome = $env:HERDR_APP_HOME
  $env:HERDR_APP_HOME = $AppHome
  try {
    & $herdrExe check $modTarget
    if ($LASTEXITCODE -ne 0) { $checkFailed = $true }
  } catch {
    $checkFailed = $true
    Write-Warning "herdr-app check failed: $($_.Exception.Message)"
  } finally {
    if ($null -eq $previousAppHome) { Remove-Item Env:HERDR_APP_HOME -ErrorAction SilentlyContinue }
    else { $env:HERDR_APP_HOME = $previousAppHome }
  }
} else {
  Write-Warning "herdr-app was not found; skipping the mod check."
}

Write-Host ""
if ($checkFailed) {
  Write-Warning "Muster was copied, but the mod check failed. The install is not usable yet."
} else {
  Write-Host "Muster is installed."
}
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Show the layout with Ctrl+Shift+L until Muster comes up,"
Write-Host "     or run 'Show layout: Muster' from the command palette."
Write-Host "  2. Point an MCP client at:"
if ($Compile) {
  Write-Host "       $command mcp"
} else {
  Write-Host "       $($bun.Source) $installedCli mcp"
}
Write-Host "     See docs\agents-snippet.md for Claude Code and Codex."
Write-Host "  3. Add 'alt-m': 'layout.switch:muster' to the global section of"
Write-Host "     $keysPath for a direct key."
Write-Host ""

if ($checkFailed) { exit 1 }
exit 0
