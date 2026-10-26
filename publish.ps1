<#
.SYNOPSIS
    Exports fresh data from the bot and publishes it to the live site's data bucket on Cloudflare R2.

.DESCRIPTION
    1. Fills in data/ or state/ from R2 if they're missing (a fresh checkout), so the export carries on from the last one.
    2. Runs tools/export.mjs against the bot's data folder (fetching titles for any new maps from the osu! API).
    3. Uploads what changed to R2 (tools/r2-sync.mjs): new files under content-hashed names, then meta.json, then files
       no manifest has used for a day are deleted; state/ goes to a private bucket. Both sites read
       https://data.ptcatch.com, so the data is live as soon as meta.json is, with no git commit and no Pages build.

    Nothing is committed: data/ and state/ aren't in git any more. An unchanged run sends three small requests, so this
    is safe to run on a schedule (install-publish-task.ps1, every 15 minutes). If R2 is unreachable it stops with an
    error and the site keeps serving the previous data.

    Free-tier guard: every R2 request is counted (state/r2.json) against hard caps well under the free tier (50% of the
    monthly Class A operations, a daily share of that, 10% of Class B, 2 GiB of storage; tools/lib/r2-budget.mjs). A run
    that would pass one sends nothing and fails with "R2 SAFETY CAP"; publishing resumes when the day or month rolls over.
    `node tools/r2-sync.mjs status` shows where things stand.

    It runs on main only, so the data always comes from the released exporter (SETUP-HOSTING.md, "Branches"), and it
    pulls first so a release pushed from elsewhere is picked up.

    R2 keys: the user environment variables R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY
    (tools/set-r2-keys.ps1 sets them).

.EXAMPLE
    .\publish.ps1              # export and upload
    .\publish.ps1 -NoUpload    # export only (into data/), e.g. to look at it with npm run serve -- --local-data
#>
param(
    [string]$DataRepo = (Join-Path (Split-Path $PSScriptRoot -Parent) 'PT-CTB-Bot-Data'),
    [switch]$NoUpload
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne 'main') {
    throw "This checkout is on '$branch'. Data is only published from main; run the copy of publish.ps1 in the main checkout (SETUP-HOSTING.md, 'Branches')."
}
git pull --ff-only --quiet
if ($LASTEXITCODE -ne 0) { throw 'git pull --ff-only failed: main here has diverged from GitHub. Sort it out by hand, then re-run.' }

function Invoke-R2([string]$command) {
    node tools/r2-sync.mjs $command
    if ($LASTEXITCODE -eq 3) { throw "R2 SAFETY CAP reached during '$command' (see the message above): nothing more was sent and the site keeps its current data." }
    if ($LASTEXITCODE -ne 0) { throw "R2 $command failed (see above); the site keeps serving the previous data." }
}

if (-not $NoUpload) {
    # Set with tools/set-r2-keys.ps1. A process started before they were set (or by a task) may not have them yet.
    foreach ($name in 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY') {
        if (-not (Test-Path "env:$name")) {
            $value = [Environment]::GetEnvironmentVariable($name, 'User')
            if ($value) { Set-Item "env:$name" $value }
        }
    }
    Invoke-R2 'restore'
}

# sharp makes the avatar thumbnails (tools/lib/avatars.mjs). Without it the export still runs and keeps the thumbnails
# it has, so a failed install only warns.
if (-not (Test-Path 'node_modules/sharp')) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Warning 'npm ci failed: avatar thumbnails are not updated this run.' }
}

node --max-old-space-size=4096 tools/export.mjs --data $DataRepo --fetch-titles
if ($LASTEXITCODE -ne 0) { throw "Export failed (exit $LASTEXITCODE)" }

if ($NoUpload) {
    Write-Host 'Exported into data/; not uploaded.'
    return
}
Invoke-R2 'upload'
Write-Host 'Published.'
