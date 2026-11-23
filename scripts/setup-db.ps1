param(
    [string]$AdminUsername = "admin",

    [string]$AdminPassword = "password@12345"
)

$ErrorActionPreference = "Stop"

$DatabaseUrlOutput = & npx netlify env:get NETLIFY_DATABASE_URL --context production --scope functions 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Could not read the linked site's production environment. Run 'netlify link' and sign in first."
}

$DatabaseUrl = ($DatabaseUrlOutput | Out-String).Trim()
if (-not $DatabaseUrl -or $DatabaseUrl -match "^No value set\b") {
    throw "NETLIFY_DATABASE_URL is not set for the linked site's production functions. Provision/connect Netlify Database, then add its connection URL as a production function environment variable."
}

if ($DatabaseUrl -notmatch "^postgres(ql)?://") {
    throw "Netlify's NETLIFY_DATABASE_URL is not a valid PostgreSQL connection string."
}

if ($AdminPassword.Length -lt 12) {
    throw "AdminPassword must contain at least 12 characters"
}

$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwtSecret = [Convert]::ToBase64String($bytes)

Write-Host "Configuring Netlify environment variables..."
npx netlify env:set JWT_SECRET $jwtSecret --scope runtime --secret --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set JWT_SECRET in Netlify." }
npx netlify env:set ADMIN_USERNAME $AdminUsername --scope runtime --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set ADMIN_USERNAME in Netlify." }
npx netlify env:set ADMIN_PASSWORD $AdminPassword --scope runtime --secret --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set ADMIN_PASSWORD in Netlify." }
npx netlify env:set ORG_TIMEZONE "Africa/Accra" --scope runtime --force
if ($LASTEXITCODE -ne 0) { throw "Failed to set ORG_TIMEZONE in Netlify." }

Write-Host "Running RAMS migrations and creating the first administrator..."
$env:NETLIFY_DATABASE_URL = $DatabaseUrl
$env:JWT_SECRET = $jwtSecret
$env:ADMIN_USERNAME = $AdminUsername
$env:ADMIN_PASSWORD = $AdminPassword
$env:ORG_TIMEZONE = "Africa/Accra"
npm run migrate
if ($LASTEXITCODE -ne 0) { throw "RAMS database migration failed." }

Write-Host "Database setup complete. Deploy the site to apply the runtime configuration."
