# get-realesrgan.ps1 - fetch the Real-ESRGAN (ncnn-vulkan) portable build into this folder.
#
# The Media Organizer's Upscale action runs realesrgan-ncnn-vulkan.exe from
# ext/media-organizer/bin with its models folder beside it. Parallx never
# downloads programs itself, so this script does the one-time fetch:
#
#   powershell -ExecutionPolicy Bypass -File "<this file>"
#
# What it does: downloads the release zip from the project's GitHub releases,
# prints its SHA256, unpacks the executable, its DLLs and the models folder
# here, and removes the temporary files. Nothing else is touched.
# The binary and models are ignored by git (see .gitignore).
#
# Source: https://github.com/xinntao/Real-ESRGAN (BSD-3-Clause), portable
# build realesrgan-ncnn-vulkan (MIT). Release v0.2.5.0, 2022-04-24.

$ErrorActionPreference = 'Stop'
$Version = 'v0.2.5.0'
$Zip = 'realesrgan-ncnn-vulkan-20220424-windows.zip'
$Url = "https://github.com/xinntao/Real-ESRGAN/releases/download/$Version/$Zip"
$Bin = $PSScriptRoot
$Tmp = Join-Path $env:TEMP ("realesrgan-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Force $Tmp | Out-Null
$ZipPath = Join-Path $Tmp $Zip

Write-Host "Downloading $Url"
Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing
$Hash = (Get-FileHash $ZipPath -Algorithm SHA256).Hash
$Size = (Get-Item $ZipPath).Length
Write-Host "Downloaded $Size bytes, SHA256 $Hash"

Write-Host "Unpacking"
Expand-Archive -Path $ZipPath -DestinationPath $Tmp -Force
$Exe = Get-ChildItem $Tmp -Recurse -Filter 'realesrgan-ncnn-vulkan.exe' | Select-Object -First 1
if (-not $Exe) { throw 'The zip did not contain realesrgan-ncnn-vulkan.exe' }
$Models = Join-Path $Exe.DirectoryName 'models'
if (-not (Test-Path $Models)) { throw 'The zip did not contain a models folder' }

Copy-Item $Exe.FullName (Join-Path $Bin 'realesrgan-ncnn-vulkan.exe') -Force
Get-ChildItem $Exe.DirectoryName -Filter '*.dll' | ForEach-Object { Copy-Item $_.FullName (Join-Path $Bin $_.Name) -Force }
if (Test-Path (Join-Path $Bin 'models')) { Remove-Item (Join-Path $Bin 'models') -Recurse -Force }
Copy-Item $Models (Join-Path $Bin 'models') -Recurse -Force
Remove-Item $Tmp -Recurse -Force

Write-Host "Installed into $Bin"
Get-ChildItem $Bin | Where-Object { $_.Name -like 'realesrgan*' -or $_.Name -eq 'models' -or $_.Name -like '*.dll' } | Format-Table Name, Length
Write-Host "Done. In Parallx, choose Upscale on a photo (or press Check Again in the setup dialog)."
