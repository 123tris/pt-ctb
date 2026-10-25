<#
.SYNOPSIS
    Registers a Windows scheduled task that runs publish.ps1 every 15 minutes.

.DESCRIPTION
    The bot checks for new plays every 15 minutes, and publishing uploads only what changed to R2 (no git commit, no
    Pages build), so the site can follow at the same rhythm. The task runs as the current user, only while they are
    logged on, and is replaced if it exists. A run still going when the next one is due is left alone (the new one is
    skipped), so slow exports never pile up.
    Remove it with: Unregister-ScheduledTask -TaskName 'PT-CTB site publish'

.EXAMPLE
    .\install-publish-task.ps1                   # every 15 minutes
    .\install-publish-task.ps1 -EveryMinutes 60
#>
param([int]$EveryMinutes = 15)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'publish.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName 'PT-CTB site publish' -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Exports the PT-CTB bot data and uploads what changed to Cloudflare R2 (https://data.ptcatch.com).' -Force | Out-Null
Write-Host "Scheduled 'PT-CTB site publish' every $EveryMinutes minutes."
