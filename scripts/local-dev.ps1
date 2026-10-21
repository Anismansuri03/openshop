<#
.SYNOPSIS
  Local development workflow for the Maison monorepo on Windows.

.DESCRIPTION
  Manages the two dev processes (Medusa backend :9000, Next storefront :8000)
  without Docker, without duplicating processes, and without touching the
  database (it never runs migrations or seeds - see docs/local-development.md
  for the one-time setup commands).

  start : starts only the services whose port is free, waits for readiness,
          and prints a status summary.
  status: checks both ports and probes both HTTP endpoints (read-only).
  stop  : stops whatever process owns each port (port-based, so it works
          regardless of how the server was started).

  Logs: .local-logs\backend.out.log / backend.err.log / storefront.out.log /
  storefront.err.log (git-ignored). No secrets are printed or written.

.EXAMPLE
  .\scripts\local-dev.ps1 start
  .\scripts\local-dev.ps1 status
  .\scripts\local-dev.ps1 stop
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "status", "stop")]
    [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot ".local-logs"
$BackendPort = 9000
$StorefrontPort = 8000
$ReadinessTimeoutSec = 180

function Test-PortOpen {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $open = $result.AsyncWaitHandle.WaitOne(500, $false) -and $client.Connected
        $client.Close()
        return $open
    }
    catch {
        return $false
    }
}

function Get-HttpCode {
    param([string]$Url, [int]$TimeoutSec = 8)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return [int]$response.StatusCode
    }
    catch {
        return $null
    }
}

function Get-PortOwnerPids {
    param([int]$Port)
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) { return @() }
    @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Show-ServiceStatus {
    $backendOpen = Test-PortOpen -Port $BackendPort
    $storeOpen = Test-PortOpen -Port $StorefrontPort
    $backendCode = $null
    $storeCode = $null
    if ($backendOpen) { $backendCode = Get-HttpCode -Url "http://localhost:$BackendPort/health" }
    if ($storeOpen) { $storeCode = Get-HttpCode -Url "http://localhost:$StorefrontPort/" -TimeoutSec 15 }

    Write-Host ""
    Write-Host "Service            Port   Listening   HTTP"
    Write-Host "-----------------  -----  ----------  --------"
    $bHttp = if ($backendCode) { $backendCode } elseif ($backendOpen) { "?" } else { "-" }
    $sHttp = if ($storeCode) { $storeCode } elseif ($storeOpen) { "?" } else { "-" }
    Write-Host ("Backend            {0,-5} {1,-10} {2}" -f $BackendPort, $backendOpen, $bHttp)
    Write-Host ("Storefront         {0,-5} {1,-10} {2}" -f $StorefrontPort, $storeOpen, $sHttp)
    Write-Host ""
    return @{ Backend = $backendOpen; Storefront = $storeOpen }
}

function Start-Service {
    param([string]$Name, [string]$PnpmScript, [int]$Port, [string]$StdOutLog, [string]$StdErrLog)
    if (Test-PortOpen -Port $Port) {
        Write-Host "[$Name] already listening on :$Port - not starting a duplicate."
        return $false
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "pnpm not found on PATH. Install it first: npm install -g pnpm@10.11.1 (or enable corepack)."
    }
    Write-Host "[$Name] starting ($PnpmScript), logs -> .local-logs\"
    # cmd.exe resolves the pnpm.cmd shim; Start-Process cannot run it directly
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", "pnpm", "run", $PnpmScript) `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $StdOutLog `
        -RedirectStandardError $StdErrLog `
        -WindowStyle Hidden
    return $true
}

function Wait-Ready {
    param([string]$Name, [int]$Port, [string]$HealthPath)
    $deadline = (Get-Date).AddSeconds($ReadinessTimeoutSec)
    Write-Host "[$Name] waiting for http://localhost:$Port$HealthPath (timeout ${ReadinessTimeoutSec}s)..."
    while ((Get-Date) -lt $deadline) {
        if (Test-PortOpen -Port $Port) {
            $code = Get-HttpCode -Url "http://localhost:$Port$HealthPath" -TimeoutSec 15
            if ($code -eq 200) {
                Write-Host "[$Name] ready (HTTP 200)."
                return $true
            }
        }
        Start-Sleep -Seconds 3
    }
    Write-Host "[$Name] NOT ready after ${ReadinessTimeoutSec}s - check .local-logs\ for errors."
    return $false
}

switch ($Action) {
    "start" {
        New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
        $startedBackend = Start-Service -Name "backend" -PnpmScript "backend:dev" -Port $BackendPort `
            -StdOutLog (Join-Path $LogDir "backend.out.log") -StdErrLog (Join-Path $LogDir "backend.err.log")
        $startedStore = Start-Service -Name "storefront" -PnpmScript "storefront:dev" -Port $StorefrontPort `
            -StdOutLog (Join-Path $LogDir "storefront.out.log") -StdErrLog (Join-Path $LogDir "storefront.err.log")
        if ($startedBackend) { Wait-Ready -Name "backend" -Port $BackendPort -HealthPath "/health" | Out-Null }
        if ($startedStore) { Wait-Ready -Name "storefront" -Port $StorefrontPort -HealthPath "/" | Out-Null }
        $status = Show-ServiceStatus
        if ($status.Backend -and $status.Storefront) {
            Write-Host "Storefront: http://localhost:8000  (region prefix e.g. /dk)"
            Write-Host "Backend:    http://localhost:9000/app  (admin; create your user with:"
            Write-Host "            npx medusa user -e YOUR_EMAIL -p YOUR_PASSWORD)"
            exit 0
        }
        Write-Host "One or more services failed to become ready. See .local-logs\."
        exit 1
    }
    "status" {
        $status = Show-ServiceStatus
        if ($status.Backend -and $status.Storefront) { exit 0 }
        exit 1
    }
    "stop" {
        foreach ($entry in @(
            @{ Name = "backend"; Port = $BackendPort },
            @{ Name = "storefront"; Port = $StorefrontPort }
        )) {
            $pids = Get-PortOwnerPids -Port $entry.Port
            if ($pids.Count -eq 0) {
                Write-Host "[$($entry.Name)] nothing listening on :$($entry.Port)."
                continue
            }
            foreach ($procId in $pids) {
                $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                $procName = if ($proc) { $proc.ProcessName } else { "?" }
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                Write-Host "[$($entry.Name)] stopped PID $procId ($procName) on :$($entry.Port)."
            }
        }
        Write-Host "Done. (No database changes were made.)"
        exit 0
    }
}
