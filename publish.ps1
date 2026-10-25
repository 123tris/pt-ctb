<#
.SYNOPSIS
    Exports fresh data from the bot and publishes it to the live site.

.DESCRIPTION
    Runs tools/export.mjs against the bot's data folder (fetching titles for any new maps from the osu! API),
    then commits data/ and state/ and pushes, which redeploys the release site (Cloudflare Pages builds main).
    Does nothing when nothing changed, so it is safe to run on a schedule (see install-publish-task.ps1).

    Data only ever goes to main: the development site (branch dev) reads the release site's data. So this refuses to
    run on any other branch; keep a checkout on main for it (SETUP-HOSTING.md, "Branches").

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
$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne 'main') {
    throw "This checkout is on '$branch'. Data is only published from main; run the copy of publish.ps1 in the main checkout (SETUP-HOSTING.md, 'Branches')."
}
if (-not $NoPush) {
    # Releases (dev merged into main) may have been pushed from elsewhere; catch up first so the push below fits.
    git pull --ff-only --quiet
    if ($LASTEXITCODE -ne 0) { throw 'git pull --ff-only failed: main here has diverged from GitHub. Sort it out by hand, then re-run.' }
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
