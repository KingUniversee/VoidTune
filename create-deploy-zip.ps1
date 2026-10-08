$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceDir = 'e:\New Music'
$staging = Join-Path $sourceDir 'pterodactyl-deploy-temp'
$zipPath = Join-Path $sourceDir 'voidtune-pterodactyl.zip'

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null

Copy-Item -Recurse -Path (Join-Path $sourceDir 'dist') -Destination $staging
Copy-Item -Recurse -Path (Join-Path $sourceDir 'src') -Destination $staging
Copy-Item -Path (Join-Path $sourceDir 'package.json') -Destination $staging
Copy-Item -Path (Join-Path $sourceDir 'package-lock.json') -Destination $staging
Copy-Item -Path (Join-Path $sourceDir 'tsconfig.json') -Destination $staging
Copy-Item -Path (Join-Path $sourceDir 'ecosystem.config.js') -Destination $staging

$envFile = Join-Path $sourceDir '.env'
if (Test-Path $envFile) {
    Copy-Item -Path $envFile -Destination $staging
}

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath)
Remove-Item -Recurse -Force $staging

$zipItem = Get-Item $zipPath
Write-Host "Created: $($zipItem.FullName) ($([math]::Round($zipItem.Length / 1KB, 2)) KB)"
