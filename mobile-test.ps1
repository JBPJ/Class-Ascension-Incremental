# Starts the game server + a Cloudflare quick tunnel and prints the public URL.
# Usage: powershell -ExecutionPolicy Bypass -File mobile-test.ps1
$ErrorActionPreference = 'Stop'
$port = 8123
$cf = "$env:TEMP\cloudflared.exe"

if (-not (Test-Path $cf)) {
  Write-Host "Downloading cloudflared (one time, ~50 MB)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf -UseBasicParsing
}

# game server (skip if something already listens on the port)
$busy = Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $busy) {
  Start-Process powershell -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","$PSScriptRoot\serve.ps1","$port" -WindowStyle Minimized
  Start-Sleep -Seconds 2
}

Write-Host "Starting tunnel — the https://....trycloudflare.com line below is your phone link:"
& $cf tunnel --url "http://localhost:$port" --http-host-header localhost --no-autoupdate
