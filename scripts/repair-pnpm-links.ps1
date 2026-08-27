# Recreates pnpm's node_modules junctions.
#
# These links disappear periodically on this machine (npm/npx runs treat pnpm's
# virtual-store layout as extraneous and prune it), which breaks the build with
# errors like "Cannot find module 'next'". Re-run this script to restore them.
#
# Compatible with Windows PowerShell 5.1 — ConvertFrom-Json has no -AsHashtable
# there, so the JSON object is walked via PSObject.Properties instead.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path $PSScriptRoot -Parent
$modulesRoot = Join-Path $projectRoot "node_modules"
$packageMapPath = Join-Path $modulesRoot ".package-map.json"

if (-not (Test-Path -LiteralPath $packageMapPath)) {
  throw "The package map is unavailable. Run pnpm install first."
}

$packageMap = Get-Content -Raw -LiteralPath $packageMapPath | ConvertFrom-Json

$packages = @{}
foreach ($property in $packageMap.packages.PSObject.Properties) {
  $packages[$property.Name] = $property.Value
}

$created = 0

foreach ($packageKey in $packages.Keys) {
  $definition = $packages[$packageKey]

  if ($packageKey -eq ".") {
    $dependencyRoot = $modulesRoot
  } else {
    $relativePackagePath = $definition.url -replace '^\./', ''
    if (-not (Test-Path -LiteralPath (Join-Path $modulesRoot $relativePackagePath))) { continue }
    $virtualStorePath = ($relativePackagePath -split '/node_modules/', 2)[0]
    $dependencyRoot = Join-Path $modulesRoot (Join-Path $virtualStorePath 'node_modules')
  }

  # Optional dependencies matter too: miniflare reaches workerd through one,
  # and a missing workerd link breaks `vinext build` outright.
  $dependencySets = @()
  if ($definition.dependencies) { $dependencySets += $definition.dependencies }
  if ($definition.optionalDependencies) { $dependencySets += $definition.optionalDependencies }

  foreach ($dependencySet in $dependencySets) {
    foreach ($dependency in $dependencySet.PSObject.Properties) {
      $dependencyKey = $dependency.Value
      if (-not $packages.ContainsKey($dependencyKey)) { continue }

      $targetPath = Join-Path $modulesRoot ($packages[$dependencyKey].url -replace '^\./', '')
      if (-not (Test-Path -LiteralPath $targetPath)) { continue }

      $destination = Join-Path $dependencyRoot $dependency.Name
      if (Test-Path -LiteralPath $destination) { continue }

      $destinationParent = Split-Path $destination -Parent
      if (-not (Test-Path -LiteralPath $destinationParent)) {
        New-Item -ItemType Directory -Path $destinationParent | Out-Null
      }

      New-Item -ItemType Junction -Path $destination -Target $targetPath | Out-Null
      $created++
    }
  }
}

Write-Output "Recreated $created package links."
