<#
.SYNOPSIS
    Installs Screen Drop on Windows.

.DESCRIPTION
    Two routes, tried in order:

      1. The published installer from GitHub Releases. Takes about a minute and
         needs nothing but Windows.
      2. Building from source. Needs Rust, Node and the MSVC build tools, and
         takes ten to fifteen minutes the first time.

    Route 1 is tried first because most people do not want a toolchain, they
    want the app. Route 2 is the fallback for a machine that cannot reach the
    release, or a checkout that is ahead of it.

    Everything installs per-user. Nothing here needs administrator rights, and
    nothing touches drivers, audio devices or system settings.

.PARAMETER FromSource
    Skip the release and build from this checkout.

.PARAMETER CheckOnly
    Report what is present and what the install would do, then stop. Nothing is
    downloaded, built or installed.

.PARAMETER Repo
    owner/name to pull releases from. Defaults to this checkout's origin.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -CheckOnly
#>
[CmdletBinding()]
param(
    [switch]$FromSource,
    [switch]$CheckOnly,
    [string]$Repo = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$AppName = "Screen Drop"
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Say([string]$text) { Write-Host $text }
function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "   ok  $text" -ForegroundColor Green }
function Warn([string]$text) { Write-Host "   !   $text" -ForegroundColor Yellow }
function Die([string]$text) { Write-Host "`nX  $text" -ForegroundColor Red; exit 1 }

function Have([string]$name) {
    $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# ---------------------------------------------------------------------------
# Where we are
# ---------------------------------------------------------------------------

Step "Checking this machine"

if ([Environment]::OSVersion.Platform -ne "Win32NT") {
    Die "Screen Drop is Windows-only. It captures through Windows Graphics Capture, which has no equivalent elsewhere."
}

$build = [int](Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction SilentlyContinue).CurrentBuild
if ($build -and $build -lt 17763) {
    Die "Windows 10 1809 (build 17763) or newer is required; this is build $build. Windows Graphics Capture does not exist before it."
}
Ok "Windows build $build"

if ([Environment]::Is64BitOperatingSystem) {
    Ok "64-bit"
} else {
    Die "A 64-bit Windows is required."
}

# WebView2 renders the whole interface. Windows 11 always has it; Windows 10
# usually does, and the installer pulls it in when it does not.
$webview = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($webview) {
    Ok "WebView2 runtime present"
} else {
    Warn "WebView2 runtime not found  - the installer will fetch it (about 100 MB)."
}

$existing = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq $AppName }
if ($existing) {
    Warn "$AppName $($existing.DisplayVersion) is already installed; this will replace it. Boards and settings are kept."
}

# ---------------------------------------------------------------------------
# Route 1  - the published installer
# ---------------------------------------------------------------------------

function Resolve-Repo {
    if ($Repo) { return $Repo }
    try {
        $url = git -C $RepoRoot remote get-url origin 2>$null
        if ($url -match "github\.com[:/](.+?)(\.git)?$") { return $Matches[1] }
    } catch {}
    return ""
}

function Get-ReleaseInstaller {
    $slug = Resolve-Repo
    if (-not $slug) { Warn "No GitHub remote to pull a release from."; return $null }

    Say "   looking for a release in $slug"
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$slug/releases/latest" `
            -Headers @{ "User-Agent" = "screen-drop-install" } -TimeoutSec 20
    } catch {
        # A private repo answers 404 to an anonymous request, which is the
        # normal case before launch rather than anything being wrong.
        Warn "No public release yet ($($_.Exception.Message.Split([Environment]::NewLine)[0]))."
        return $null
    }

    $asset = $release.assets | Where-Object { $_.name -like "*-setup.exe" } | Select-Object -First 1
    if (-not $asset) { Warn "Release $($release.tag_name) has no installer attached."; return $null }

    $target = Join-Path ([IO.Path]::GetTempPath()) $asset.name
    Say "   downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -TimeoutSec 300
    Ok "downloaded $($release.tag_name)"
    return $target
}

# ---------------------------------------------------------------------------
# Route 2  - build it here
# ---------------------------------------------------------------------------

function Test-BuildTools {
    $missing = @()
    if (-not (Have "cargo")) { $missing += "Rust (https://rustup.rs)  - the app core is Rust" }
    if (-not (Have "node")) { $missing += "Node.js 18+ (https://nodejs.org)  - the interface is built with Vite" }

    # Tauri links with MSVC. Without it cargo fails deep in a build script with
    # an error that reads like a Rust problem and is not one.
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $hasMsvc = $false
    if (Test-Path $vswhere) {
        $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        $hasMsvc = [bool]$found
    }
    if (-not $hasMsvc -and -not (Have "link")) {
        $missing += "MSVC build tools (Visual Studio Installer -> 'Desktop development with C++')  - Rust links against them on Windows"
    }
    return $missing
}

function Build-Installer {
    $missing = Test-BuildTools
    if ($missing.Count) {
        Say ""
        Say "Building from source needs:"
        foreach ($m in $missing) { Say "  - $m" }
        Die "Install those, open a new terminal so PATH updates, and run this again."
    }
    Ok "Rust, Node and MSVC all present"

    Push-Location $RepoRoot
    try {
        if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
            Step "Installing dependencies"
            # Out-Host, not bare: a native command's stdout joins this
            # function's pipeline output, and `return $path` would then hand
            # back an array of every build log line with the path on the end.
            if (Have "pnpm") { pnpm install | Out-Host } else { npm install | Out-Host }
            if ($LASTEXITCODE -ne 0) { Die "Dependency install failed." }
        }

        Step "Building (ten to fifteen minutes the first time  - Rust is compiling)"
        if (Have "pnpm") { pnpm tauri build | Out-Host } else { npx tauri build | Out-Host }
        if ($LASTEXITCODE -ne 0) { Die "Build failed. The output above says why." }
    } finally {
        Pop-Location
    }

    $built = Get-ChildItem -Path (Join-Path $RepoRoot "src-tauri\target\release\bundle\nsis") -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $built) { Die "The build finished but produced no installer." }
    Ok "built $($built.Name)"
    return $built.FullName
}

# ---------------------------------------------------------------------------
# Go
# ---------------------------------------------------------------------------

if ($CheckOnly) {
    Step "Check only  - nothing will be installed"
    $missing = Test-BuildTools
    if ($missing.Count) {
        Say "   Cannot build from source. Missing:"
        foreach ($m in $missing) { Say "     - $m" }
        Say "   The published installer route needs none of this."
    } else {
        Ok "This machine can build from source."
    }
    Say ""
    Say "   Would install to: $InstallDir"
    exit 0
}

$installer = $null
if (-not $FromSource) {
    Step "Looking for a published installer"
    $installer = Get-ReleaseInstaller
}
if (-not $installer) {
    Step "Building from this checkout"
    $installer = Build-Installer
}
# Collapse to a single path however it came back.
if ($installer -is [array]) { $installer = $installer[-1] }
$installer = [string]$installer
if (-not (Test-Path $installer)) { Die "No installer to run at '$installer'." }

Step "Installing"

# The installer refuses to overwrite a running copy, and the failure is silent.
Get-Process -Name "screen-drop" -ErrorAction SilentlyContinue | ForEach-Object {
    Warn "closing a running copy (pid $($_.Id))"
    $_.CloseMainWindow() | Out-Null
    Start-Sleep -Milliseconds 800
    if (-not $_.HasExited) { $_ | Stop-Process -Force }
}

# /S is NSIS silent mode. Per-user, so no elevation prompt.
$proc = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
if ($proc.ExitCode -ne 0) { Die "The installer exited with code $($proc.ExitCode)." }

# ---------------------------------------------------------------------------
# Prove it worked, rather than assuming
# ---------------------------------------------------------------------------

Step "Checking the install"

$exe = Join-Path $InstallDir "screen-drop.exe"
if (Test-Path $exe) {
    Ok "installed to $InstallDir"
} else {
    Die "The installer reported success but $exe is not there."
}

$shortcut = Get-ChildItem -Path (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs") `
    -Filter "*Screen Drop*" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($shortcut) {
    Ok "Start Menu shortcut  - type 'screen drop' to find it"
} else {
    Warn "No Start Menu shortcut was created. Launch it from $exe."
}

$entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq $AppName }
if ($entry) { Ok "version $($entry.DisplayVersion), removable from Settings -> Apps" }

Say ""
Say "Done. Screen Drop is installed." -ForegroundColor Green
Say ""
Say "  Open it from the Start Menu, add your screens, then share the"
Say "  'Screen Drop - Board' window in Discord, Meet, Zoom or Teams."
Say ""
Say "  Only the blue rectangle - the stage - is ever shared. The rest of"
Say "  the board is yours."
Say ""
