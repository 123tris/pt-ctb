<#
.SYNOPSIS
    Registers a Windows scheduled task that runs publish.ps1 every few hours.

.DESCRIPTION
    The bot imports everyone's recent scores every 4 hours, so publishing on the same rhythm keeps the site
    current. The task runs as the current user, only while they are logged on, and is replaced if it exists.
    Remove it with: Unregister-ScheduledTask -TaskName 'PT-CTB site publish'

.EXAMPLE
    .\install-publish-task.ps1                # every 4 hours
    .\install-publish-task.ps1 -EveryHours 2
#>
param([int]$EveryHours = 4)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'publish.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Hours $EveryHours)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName 'PT-CTB site publish' -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Exports the PT-CTB bot data to the site and pushes it to main (the release site).' -Force | Out-Null
Write-Host "Scheduled 'PT-CTB site publish' every $EveryHours hours."
