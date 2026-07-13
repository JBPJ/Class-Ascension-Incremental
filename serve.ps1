# Minimal static file server for local testing (no Node/Python required).
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [port]
param([int]$Port = 8123)

$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html'; '.css' = 'text/css'; '.js' = 'application/javascript';
  '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json';
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon';
}

$listener = New-Object System.Net.HttpListener
# Try to listen on all interfaces (lets phones on the same Wi-Fi connect).
# Needs a one-time: netsh http add urlacl url=http://+:PORT/ user=Everyone
$listener.Prefixes.Add("http://+:$Port/")
try {
  $listener.Start()
  Write-Host "Serving $root at http://localhost:$Port/ (and on the LAN)"
} catch {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$Port/")
  $listener.Start()
  Write-Host "Serving $root at http://localhost:$Port/ (localhost only)"
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($path -eq '/') { $path = '/index.html' }
  $file = Join-Path $root ($path -replace '/', '\')
  $full = [System.IO.Path]::GetFullPath($file)
  if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ext = [System.IO.Path]::GetExtension($full).ToLower()
    $ctx.Response.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
