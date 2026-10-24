<#
.SYNOPSIS
    Exports fresh data from the bot and publishes it to the live site.

.DESCRIPTION
    Runs tools/export.mjs against the bot's data folder (fetching titles for any new maps from the osu! API),
    then commits data/ and state/ and pushes, which redeploys GitHub Pages. Does nothing when nothing changed,
    so it is safe to run on a schedule (see install-publish-task.ps1).

.EXAMPLE
    .\publish.ps1              # export, commit, push
    .\publish.ps1 -NoPush      # export and commit only
#>
param(
    [string]$DataRepo = (Join-Path (Split-Path $PSScriptRoot -Parent) 'PT-CTB-Bot-Data'),
    [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $NoPush -and -not (git remote)) {
    throw "This repo has no git remote yet. Create the GitHub repo, then: git remote add origin https://github.com/<you>/pt-ctb.git"
}

node --max-old-space-size=4096 tools/export.mjs --data $DataRepo --fetch-titles
if ($LASTEXITCODE -ne 0) { throw "Export failed (exit $LASTEXITCODE)" }

git add -A data state
git diff --cached --quiet
$dataChanged = $LASTEXITCODE -ne 0
# Commits made by hand (e.g. site code) still need pushing even when the data didn't change.
$unpushed = [int](git rev-list --count '@{u}..HEAD' 2>$null)
if (-not $dataChanged -and $unpushed -eq 0) {
    Write-Host 'Nothing new to publish.'
    return
}

if ($dataChanged) {
    git commit -m "Update data ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
}
if (-not $NoPush) {
    git push
    if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
}
Write-Host 'Published.'
