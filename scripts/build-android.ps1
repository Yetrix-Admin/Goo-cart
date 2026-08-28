[CmdletBinding()]
param(
  [ValidateSet("customer", "vendor", "delivery", "partner", "all")]
  [string]$App = "all",

  [ValidateSet("apk", "aab", "both")]
  [string]$Artifact = "both",

  [switch]$Prebuild,
  [switch]$VerifyOnly,
  [switch]$AllowDebugSigning,

  [string]$ApiUrl = "https://goo-cart.onrender.com"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $repoRoot "outputs\android"
$projectGradleHome = Join-Path $repoRoot ".gradle-cache"

# Android Studio bundles a JDK, but it does not always expose JAVA_HOME to
# external PowerShell sessions. Prefer an already-installed Gradle JDK 17 and
# keep Gradle's cache inside the repository instead of falling back to
# unwritable C:\.gradle.
if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
  $gradleJdk17 = Join-Path $env:USERPROFILE ".gradle\jdks\eclipse_adoptium-17-amd64-windows.2"
  $androidStudioJdk = "C:\Program Files\Android\Android Studio\jbr"
  if (Test-Path (Join-Path $gradleJdk17 "bin\java.exe")) {
    $env:JAVA_HOME = $gradleJdk17
  } elseif (Test-Path (Join-Path $androidStudioJdk "bin\java.exe")) {
    $env:JAVA_HOME = $androidStudioJdk
  }
}
if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
  $env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$env:Path"
}
$env:GRADLE_USER_HOME = $projectGradleHome

$apps = @(
  [pscustomobject]@{
    Key = "customer"
    Folder = "customer"
    DisplayName = "Goocart Customer"
    Package = "com.goocart.customer"
    ArtifactName = "Goocart-Customer"
    SigningPrefix = "GOOCART_"
  },
  [pscustomobject]@{
    Key = "vendor"
    Folder = "vendor"
    DisplayName = "Goocart Vendor"
    Package = "com.goocart.vendor"
    ArtifactName = "Goocart-Vendor"
    SigningPrefix = "GOOCARTVENDOR_"
  },
  [pscustomobject]@{
    Key = "delivery"
    Folder = "partner"
    DisplayName = "Goocart Delivery Partner"
    Package = "com.goocart.delivery"
    ArtifactName = "Goocart-Delivery"
    SigningPrefix = "GOOCARTDELIVERY_"
  }
)

if ($App -eq "partner") {
  $App = "delivery"
}
if ($App -ne "all") {
  $apps = @($apps | Where-Object Key -eq $App)
}

function Assert-ProductionApiUrl {
  param([string]$Value)

  try {
    $uri = [Uri]$Value
  } catch {
    throw "Invalid production API URL: $Value"
  }

  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https") {
    throw "Production API URL must use HTTPS: $Value"
  }

  $hostName = $uri.Host.ToLowerInvariant()
  if (
    $hostName -match '(^|\.)(localhost|dev|development|staging|test)(\.|$)' -or
    $hostName.EndsWith(".local") -or
    $hostName -match '^127\.' -or
    $hostName -match '^10\.' -or
    $hostName -match '^192\.168\.' -or
    $hostName -match '^172\.(1[6-9]|2[0-9]|3[01])\.' -or
    $hostName -eq "::1"
  ) {
    throw "Production API URL cannot use a local, private, dev, test, or staging host: $Value"
  }
}

function Get-SigningState {
  param($AppConfig, [string]$AppRoot)

  $gradleProperties = Join-Path $AppRoot "android\gradle.properties"
  if (-not (Test-Path $gradleProperties)) {
    return [pscustomobject]@{ Ready = $false; StoreFile = $null }
  }

  $prefix = $AppConfig.SigningPrefix
  $requiredNames = @(
    "${prefix}UPLOAD_STORE_FILE",
    "${prefix}UPLOAD_STORE_PASSWORD",
    "${prefix}UPLOAD_KEY_ALIAS",
    "${prefix}UPLOAD_KEY_PASSWORD"
  )
  $properties = @{}
  foreach ($line in Get-Content $gradleProperties) {
    if ($line -match '^\s*([^#][^=]*)=(.*)$') {
      $properties[$matches[1].Trim()] = $matches[2].Trim()
    }
  }

  foreach ($name in $requiredNames) {
    if (-not $properties.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($properties[$name])) {
      return [pscustomobject]@{ Ready = $false; StoreFile = $null }
    }
  }

  $storeFile = Join-Path (Join-Path $AppRoot "android\app") $properties["${prefix}UPLOAD_STORE_FILE"]
  return [pscustomobject]@{ Ready = (Test-Path $storeFile); StoreFile = $storeFile }
}

Assert-ProductionApiUrl $ApiUrl
$env:EXPO_PUBLIC_API_URL = $ApiUrl.TrimEnd("/")
$env:NODE_ENV = "production"

foreach ($appConfig in $apps) {
  $appRoot = Join-Path $repoRoot $appConfig.Folder
  $appJsonPath = Join-Path $appRoot "app.json"
  $appJson = Get-Content $appJsonPath -Raw | ConvertFrom-Json
  $expo = $appJson.expo

  if ($expo.name -ne $appConfig.DisplayName) {
    throw "$($appConfig.Key): expected display name '$($appConfig.DisplayName)', found '$($expo.name)'."
  }
  if ($expo.android.package -ne $appConfig.Package) {
    throw "$($appConfig.Key): expected Android package '$($appConfig.Package)', found '$($expo.android.package)'."
  }
  $cleartextSetting = $null
  foreach ($plugin in $expo.plugins) {
    if ($plugin -isnot [string] -and $plugin.Count -gt 1 -and $plugin[0] -eq "expo-build-properties") {
      $cleartextSetting = $plugin[1].android.usesCleartextTraffic
      break
    }
  }
  if ($cleartextSetting -ne $false) {
    throw "$($appConfig.Key): release config must set usesCleartextTraffic to false."
  }

  $assetPaths = @(
    $expo.icon,
    $expo.android.adaptiveIcon.foregroundImage,
    $expo.android.adaptiveIcon.backgroundImage,
    $expo.android.adaptiveIcon.monochromeImage
  )
  foreach ($assetPath in $assetPaths) {
    $resolvedAsset = Join-Path $appRoot ($assetPath -replace '^\./', '')
    if (-not (Test-Path $resolvedAsset)) {
      throw "$($appConfig.Key): branding asset not found: $assetPath"
    }
  }

  $envFile = Join-Path $appRoot ".env"
  if (Test-Path $envFile) {
    $envUrlLine = Get-Content $envFile | Where-Object { $_ -match '^\s*EXPO_PUBLIC_API_URL=' } | Select-Object -Last 1
    if ($envUrlLine) {
      Assert-ProductionApiUrl (($envUrlLine -split '=', 2)[1].Trim())
    }
  }

  if ($Prebuild) {
    $expoCommand = Join-Path $appRoot "node_modules\.bin\expo.cmd"
    if (-not (Test-Path $expoCommand)) {
      throw "$($appConfig.Key): Expo CLI is missing. Run npm ci in $($appConfig.Folder) first."
    }
    Push-Location $appRoot
    try {
      & $expoCommand prebuild --platform android --no-install
      if ($LASTEXITCODE -ne 0) {
        throw "$($appConfig.Key): Expo prebuild failed with exit code $LASTEXITCODE."
      }
    } finally {
      Pop-Location
    }
  }

  $androidRoot = Join-Path $appRoot "android"
  $appGradle = Join-Path $androidRoot "app\build.gradle"
  $manifest = Join-Path $androidRoot "app\src\main\AndroidManifest.xml"
  $strings = Join-Path $androidRoot "app\src\main\res\values\strings.xml"
  if (-not (Test-Path $appGradle)) {
    throw "$($appConfig.Key): native Android project is missing. Re-run with -Prebuild."
  }

  $gradleText = Get-Content $appGradle -Raw
  $manifestText = Get-Content $manifest -Raw
  $stringsText = Get-Content $strings -Raw
  if ($gradleText -notmatch "applicationId '$([regex]::Escape($appConfig.Package))'") {
    throw "$($appConfig.Key): generated applicationId is stale. Re-run with -Prebuild."
  }
  if ($stringsText -notmatch "<string name=`"app_name`">$([regex]::Escape($appConfig.DisplayName))</string>") {
    throw "$($appConfig.Key): generated app label is stale. Re-run with -Prebuild."
  }
  if ($manifestText -notmatch 'android:usesCleartextTraffic="false"') {
    throw "$($appConfig.Key): generated release manifest still permits clear-text traffic. Re-run with -Prebuild."
  }

  Write-Host "Verified $($appConfig.DisplayName) ($($appConfig.Package)) -> $env:EXPO_PUBLIC_API_URL"
  if ($VerifyOnly) {
    continue
  }

  $signingState = Get-SigningState $appConfig $appRoot
  if (-not $signingState.Ready -and -not $AllowDebugSigning) {
    throw "$($appConfig.Key): production signing is not configured. Add the four $($appConfig.SigningPrefix)UPLOAD_* properties and keystore, or use -AllowDebugSigning only for a non-publishable verification build."
  }

  $tasks = switch ($Artifact) {
    "apk" { @("assembleRelease") }
    "aab" { @("bundleRelease") }
    default { @("assembleRelease", "bundleRelease") }
  }
  $gradleArgs = @($tasks)
  if (-not $signingState.Ready) {
    $gradleArgs += "-Pgoocart.allowDebugSigning=true"
  }

  Push-Location $androidRoot
  try {
    & .\gradlew.bat @gradleArgs
    if ($LASTEXITCODE -ne 0) {
      throw "$($appConfig.Key): Gradle release build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $version = $expo.version
  $suffix = if ($signingState.Ready) { "release" } else { "verification-debug-signed" }

  if ($Artifact -in @("apk", "both")) {
    $apkSource = Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk"
    if (-not (Test-Path $apkSource)) {
      throw "$($appConfig.Key): Gradle succeeded but the release APK was not found."
    }
    $apkTarget = Join-Path $outputRoot "$($appConfig.ArtifactName)-v$version-$suffix.apk"
    Copy-Item $apkSource $apkTarget -Force
    Write-Host "APK: $apkTarget"
  }

  if ($Artifact -in @("aab", "both")) {
    $aabSource = Join-Path $androidRoot "app\build\outputs\bundle\release\app-release.aab"
    if (-not (Test-Path $aabSource)) {
      throw "$($appConfig.Key): Gradle succeeded but the release AAB was not found."
    }
    $aabTarget = Join-Path $outputRoot "$($appConfig.ArtifactName)-v$version-$suffix.aab"
    Copy-Item $aabSource $aabTarget -Force
    Write-Host "AAB: $aabTarget"
  }
}

if ($VerifyOnly) {
  Write-Host "All selected Android release configurations passed verification."
}
