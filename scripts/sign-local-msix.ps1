param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9A-Fa-f]{40}$')][string]$Thumbprint,
    [Parameter(Mandatory = $true)][string]$UnsignedPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+\.\d+$')][string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = (Resolve-Path -LiteralPath $UnsignedPath).Path
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$Thumbprint" -ErrorAction Stop
if ($certificate.Subject -ne 'CN=RUMAR Local Development' -or -not $certificate.HasPrivateKey) {
    throw 'The local RUMAR code-signing certificate is missing or has the wrong identity.'
}
if (-not ($certificate.EnhancedKeyUsageList | Where-Object ObjectId -eq '1.3.6.1.5.5.7.3.3')) {
    throw 'The certificate lacks Code Signing EKU.'
}

$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$tools = @{}
foreach ($name in @('makeappx.exe', 'signtool.exe')) {
    $tool = Get-ChildItem -LiteralPath $sdkRoot -Filter $name -Recurse -File |
        Where-Object { $_.DirectoryName -like '*\x64' } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $tool) { throw "Missing Windows SDK tool: $name" }
    $tools[$name] = $tool.FullName
}
$out = Join-Path $root "artifacts/local-msix-signed/$Version"
$stage = Join-Path $out 'stage'
if (Test-Path -LiteralPath $stage) { throw 'Signing stage already exists; inspect it before retrying.' }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory($source, $stage)
foreach ($generated in @('AppxBlockMap.xml', 'AppxSignature.p7x', '[Content_Types].xml')) {
    $path = Join-Path $stage $generated
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}
$manifest = [xml](Get-Content -LiteralPath (Join-Path $stage 'AppxManifest.xml') -Raw)
$identity = $manifest.Package.Identity
if ($identity.Name -ne 'RUMAR.Local' -or $identity.Publisher -ne $certificate.Subject -or $identity.Version -ne $Version -or $identity.ProcessorArchitecture -ne 'x64') {
    throw 'Unexpected package identity. No binary was signed.'
}
$app = Join-Path $stage 'rumar.exe'
$node = Join-Path $stage 'finance-gateway/node.exe'
if ((Get-AuthenticodeSignature -LiteralPath $node).Status -ne 'Valid') { throw 'Bundled Node signature is not valid.' }
& $tools['signtool.exe'] sign /fd SHA256 /sha1 $Thumbprint /s My $app
if ($LASTEXITCODE -ne 0) { throw 'Signing rumar.exe failed.' }
if ((Get-AuthenticodeSignature -LiteralPath $node).Status -ne 'Valid') { throw 'Bundled Node signature changed.' }
$package = Join-Path $out "RUMAR_${Version}_x64-local.msix"
if (Test-Path -LiteralPath $package) { throw 'Signed package already exists; inspect it before retrying.' }
& $tools['makeappx.exe'] pack /d $stage /p $package /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx failed.' }
& $tools['signtool.exe'] sign /fd SHA256 /sha1 $Thumbprint /s My $package
if ($LASTEXITCODE -ne 0) { throw 'Signing MSIX failed.' }
foreach ($signed in @($app, $package)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $signed
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
        throw "Unexpected signer: $signed"
    }
}
Write-Output 'Signer identity matches the local certificate. Final SignTool /pa verification requires TrustedPeople.'
$file = Get-Item -LiteralPath $package
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash
Write-Output "$($file.FullName) | bytes=$($file.Length) | SHA256=$hash"
