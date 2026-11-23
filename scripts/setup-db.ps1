param(
    [string]$AdminUsername = "admin",

    [string]$AdminPassword = "password@12345"
)

$ErrorActionPreference = "Stop"

if ($AdminPassword.Length -lt 12) {
    throw "AdminPassword must contain at least 12 characters"
}

$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwtSecret = [Convert]::ToBase64String($bytes)

Write-Host "Configuring production function environment variables..."
npx netlify env:set JWT_SECRET $jwtSecret --context production --scope functions --secret --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set JWT_SECRET in Netlify." }
npx netlify env:set ADMIN_USERNAME $AdminUsername --context production --scope functions --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set ADMIN_USERNAME in Netlify." }
npx netlify env:set ADMIN_PASSWORD $AdminPassword --context production --scope functions --secret --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set ADMIN_PASSWORD in Netlify." }
npx netlify env:set ORG_TIMEZONE "Africa/Accra" --context production --scope functions --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set ORG_TIMEZONE in Netlify." }

Write-Host "Environment configured. Deploy the site; RAMS initializes its schema on the first API request."
