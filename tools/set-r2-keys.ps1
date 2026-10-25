<#
.SYNOPSIS
    Stores the R2 API token's keys as user environment variables, for publish.ps1.

.DESCRIPTION
    Run it yourself in your own PowerShell window and paste the values when asked. The secret is typed hidden and is
    never shown, logged or written into the repo. It sets, for your Windows user only:
      R2_ACCOUNT_ID          the Cloudflare account ID (not secret)
      R2_ACCESS_KEY_ID       the token's Access Key ID
      R2_SECRET_ACCESS_KEY   the token's Secret Access Key
    Then checks that publish can reach both buckets. Re-run it to replace them (e.g. after rolling the token).

.EXAMPLE
    .\tools\set-r2-keys.ps1
#>
$ErrorActionPreference = 'Stop'

function Read-Plain([string]$prompt) {
    $secure = Read-Host $prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$account = Read-Host 'Cloudflare account ID (R2 overview page, "Account ID")'
$keyId = Read-Plain 'R2 Access Key ID (hidden)'
$secret = Read-Plain 'R2 Secret Access Key (hidden)'
if (-not $account -or -not $keyId -or -not $secret) { throw 'All three values are needed; nothing was saved.' }

foreach ($pair in @(@('R2_ACCOUNT_ID', $account.Trim()), @('R2_ACCESS_KEY_ID', $keyId.Trim()), @('R2_SECRET_ACCESS_KEY', $secret.Trim()))) {
    [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'User')
    Set-Item "env:$($pair[0])" $pair[1]
}
Write-Host 'Saved R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY for your Windows user.'

node (Join-Path $PSScriptRoot 'r2-sync.mjs') check
if ($LASTEXITCODE -ne 0) { Write-Warning 'The keys were saved, but R2 refused them or a bucket is missing (see above).' }
