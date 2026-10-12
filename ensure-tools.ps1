# Installs Git or Node.js for auto-setup.bat when they are missing.
# Prints one line to stdout: the directory to prepend to PATH, or nothing if
# the command is already on PATH. Progress goes to the console via Write-Host.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('git', 'node')]
    [string]$Tool,
    [string]$ResultFile
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($machine -and $user) { $env:Path = "$machine;$user" }
    elseif ($machine) { $env:Path = $machine }
    elseif ($user) { $env:Path = $user }
}

function Test-ToolOnPath {
    Refresh-Path
    return [bool](Get-Command $Tool -ErrorAction SilentlyContinue)
}

function Find-ExistingDir {
    param([string[]]$Dirs, [string]$ExeName)
    foreach ($dir in $Dirs) {
        if (-not $dir) { continue }
        if (Test-Path -LiteralPath (Join-Path $dir $ExeName)) { return $dir }
    }
    return $null
}

function Add-UserPath {
    param([string]$Dir)
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($user) { $parts = $user -split ';' | Where-Object { $_ } }
    $already = $false
    foreach ($part in $parts) {
        if ($part.TrimEnd('\') -eq $Dir.TrimEnd('\')) { $already = $true }
    }
    if (-not $already) {
        $joined = (@($parts) + $Dir) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $joined, 'User')
    }
}

function Try-Winget {
    param([string]$Id)
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
    Write-Host "[..] installing $Id with winget..."
    & winget install --id $Id -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
    # 0 = installed, -1978335189 = already installed
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
        Write-Host "[WARN] winget did not install $Id (exit $LASTEXITCODE)"
        return $false
    }
    return $true
}

function Install-PortableGit {
    $dest = Join-Path $env:LOCALAPPDATA 'LarpTool\git'
    $headers = @{ 'User-Agent' = 'larpcord-setup' }
    Write-Host "[..] looking up the latest Git for Windows..."
    $rel = Invoke-RestMethod -Headers $headers -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest'
    $asset = $rel.assets | Where-Object { $_.name -match '^MinGit-.+-64-bit\.zip$' } | Select-Object -First 1
    if (-not $asset) { throw 'Could not find a MinGit download.' }
    $zip = Join-Path $env:TEMP $asset.name
    Write-Host "[..] downloading $($asset.name)..."
    Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $zip
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Write-Host "[..] extracting Git..."
    Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
    $cmd = Join-Path $dest 'cmd'
    if (-not (Test-Path -LiteralPath (Join-Path $cmd 'git.exe'))) {
        throw "Git extracted but git.exe was not at $cmd"
    }
    return $cmd
}

function Install-PortableNode {
    $destRoot = Join-Path $env:LOCALAPPDATA 'LarpTool\node'
    Write-Host "[..] looking up the latest Node.js LTS..."
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
    $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
    if (-not $lts) { throw 'Could not find a Node.js LTS release.' }
    $ver = [string]$lts.version
    $bare = $ver.TrimStart('v')
    $url = "https://nodejs.org/dist/$ver/node-v$bare-win-x64.zip"
    $zip = Join-Path $env:TEMP "node-v$bare-win-x64.zip"
    Write-Host "[..] downloading Node.js $ver..."
    Invoke-WebRequest -Uri $url -OutFile $zip
    if (Test-Path -LiteralPath $destRoot) { Remove-Item -LiteralPath $destRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $destRoot -Force | Out-Null
    Write-Host "[..] extracting Node.js..."
    Expand-Archive -LiteralPath $zip -DestinationPath $destRoot -Force
    $node = Get-ChildItem -LiteralPath $destRoot -Recurse -Filter node.exe | Select-Object -First 1
    if (-not $node) { throw 'Node.js extracted but node.exe was not found.' }
    return $node.DirectoryName
}

if ($Tool -eq 'git') {
    $exe = 'git.exe'
    $known = @(
        "$env:ProgramFiles\Git\cmd",
        ${env:ProgramFiles(x86)} + '\Git\cmd',
        "$env:LocalAppData\Programs\Git\cmd",
        "$env:LocalAppData\LarpTool\git\cmd"
    )
    $wingetId = 'Git.Git'
    $portable = { Install-PortableGit }
} else {
    $exe = 'node.exe'
    $known = @(
        "$env:ProgramFiles\nodejs",
        "$env:LocalAppData\Programs\nodejs",
        "$env:LocalAppData\LarpTool\node"
    )
    $wingetId = 'OpenJS.NodeJS.LTS'
    $portable = { Install-PortableNode }
}

function Publish-BinDir {
    param([string]$Dir)
    if ($ResultFile) { Set-Content -LiteralPath $ResultFile -Value $Dir -Encoding ascii }
}

if (Test-ToolOnPath) {
    $cmd = Get-Command $Tool -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { Publish-BinDir -Dir (Split-Path -Parent $cmd.Source) }
    exit 0
}

$found = Find-ExistingDir -Dirs $known -ExeName $exe
if ($found) {
    Publish-BinDir -Dir $found
    exit 0
}

Write-Host "[..] $Tool is not installed. Installing it..."
try {
    Try-Winget -Id $wingetId | Out-Null
} catch {
    Write-Host "[WARN] winget failed: $($_.Exception.Message)"
}

Refresh-Path
if (Test-ToolOnPath) {
    $cmd = Get-Command $Tool -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { Publish-BinDir -Dir (Split-Path -Parent $cmd.Source) }
    exit 0
}
$found = Find-ExistingDir -Dirs $known -ExeName $exe
if ($found) {
    Publish-BinDir -Dir $found
    exit 0
}

try {
    $dir = & $portable
} catch {
    Write-Host "[ERROR] could not install ${Tool}: $($_.Exception.Message)"
    exit 1
}

Add-UserPath -Dir $dir
Publish-BinDir -Dir $dir
exit 0
