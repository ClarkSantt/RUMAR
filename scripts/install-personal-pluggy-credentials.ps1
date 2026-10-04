param(
  [string]$Source = (Join-Path (Split-Path -Parent $PSScriptRoot) 'local-data\pluggy-sandbox-credentials.dpapi.json'),
  [ValidateSet('com.rumo.desktop','com.rumo.validation.native.v180')]
  [string]$Identifier = 'com.rumo.validation.native.v180'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw 'Arquivo DPAPI local não encontrado.' }
$record = Get-Content -LiteralPath $Source -Raw | ConvertFrom-Json
if ($record.mode -notin @('sandbox','personal') -or
    [string]::IsNullOrWhiteSpace($record.clientId) -or
    [string]::IsNullOrWhiteSpace($record.clientSecret)) {
  throw 'Formato DPAPI local inválido.'
}
# Copy only encrypted blobs. DPAPI CurrentUser remains tied to this Windows account.
$targetRoot = Join-Path $env:APPDATA $Identifier
$target = Join-Path $targetRoot 'pluggy-personal-credentials.dpapi.json'
New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
$output = [pscustomobject]@{
  mode = 'personal'
  clientId = $record.clientId
  clientSecret = $record.clientSecret
}
$json = $output | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($target, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Credenciais DPAPI preparadas para $Identifier; nenhum valor foi exibido."
