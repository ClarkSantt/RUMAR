param(
    [string]$IdentityName = 'RUMAR.Local',
    [string]$Publisher = 'CN=RUMAR Local Development',
    [string]$PublisherDisplayName = 'RUMAR Local Development',
    [ValidatePattern('^\d+\.\d+\.\d+\.\d+$')][string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri/local.msix.conf.json') -Raw | ConvertFrom-Json
if ($config.identifier -ne 'com.rumar.desktop.local' -or $config.productName -ne 'RUMAR') {
    throw 'Local Tauri identity is not isolated from the unpackaged application.'
}
$release = Join-Path $root 'src-tauri/target/release'
$exe = Join-Path $release 'rumo.exe'
$gateway = Join-Path $release 'finance-gateway'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Tauri executable missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $gateway 'node.exe') -PathType Leaf)) { throw 'Gateway Node runtime missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $gateway 'src/server.mjs') -PathType Leaf)) { throw 'Gateway source missing.' }
$binary = [System.IO.File]::ReadAllBytes($exe)
$utf8 = [System.Text.Encoding]::UTF8.GetString($binary)
$utf16 = [System.Text.Encoding]::Unicode.GetString($binary)
if (-not ($utf8.Contains($config.identifier) -or $utf16.Contains($config.identifier))) {
    throw 'The executable does not contain the Local Tauri identifier.'
}

$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeAppx = Get-ChildItem -LiteralPath $sdkRoot -Filter makeappx.exe -Recurse -File |
    Where-Object { $_.DirectoryName -like '*\x64' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $makeAppx) { throw 'Windows SDK MakeAppx.exe is missing.' }

$out = Join-Path $root 'artifacts/local-msix'
$stage = Join-Path $out 'stage'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
if (Get-ChildItem -LiteralPath $stage -Force) { throw 'MSIX staging directory must be empty.' }
Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'rumar.exe')
Copy-Item -LiteralPath $gateway -Destination (Join-Path $stage 'finance-gateway') -Recurse

Add-Type -AssemblyName System.Drawing
$sourceIcon = Join-Path $root 'src-tauri/icons/icon.png'
if (-not (Test-Path -LiteralPath $sourceIcon -PathType Leaf)) { throw 'Source icon missing.' }
$assets = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assets | Out-Null
$image = [System.Drawing.Image]::FromFile($sourceIcon)
try {
    foreach ($size in @(44, 50, 150)) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size)
        try {
            $canvas = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $canvas.DrawImage($image, 0, 0, $size, $size)
            } finally { $canvas.Dispose() }
            $bitmap.Save((Join-Path $assets "RUMAR${size}.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $bitmap.Dispose() }
    }
} finally { $image.Dispose() }

function Escape-Xml([string]$value) { return [System.Security.SecurityElement]::Escape($value) }
$nameXml = Escape-Xml $IdentityName
$publisherXml = Escape-Xml $Publisher
$publisherDisplayXml = Escape-Xml $PublisherDisplayName
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="$nameXml" Publisher="$publisherXml" Version="$Version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>RUMAR</DisplayName>
    <PublisherDisplayName>$publisherDisplayXml</PublisherDisplayName>
    <Description>Organização pessoal local para Windows.</Description>
    <Logo>Assets\RUMAR50.png</Logo>
  </Properties>
  <Resources><Resource Language="pt-BR" /></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
  <Applications>
    <Application Id="RUMAR" Executable="rumar.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="RUMAR" Description="Organização pessoal local" Square150x150Logo="Assets\RUMAR150.png" Square44x44Logo="Assets\RUMAR44.png" BackgroundColor="#F7F8FA" />
    </Application>
  </Applications>
</Package>
"@
[System.IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, [System.Text.UTF8Encoding]::new($false))
$package = Join-Path $out "RUMAR_${Version}_x64.msix"
if (Test-Path -LiteralPath $package) { throw 'Output MSIX already exists.' }
& $makeAppx.FullName pack /d $stage /p $package /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed with code $LASTEXITCODE" }
$file = Get-Item -LiteralPath $package
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash
Write-Output "$($file.Name) | bytes=$($file.Length) | SHA256=$hash | UNSIGNED LOCAL DEVELOPMENT PACKAGE"
