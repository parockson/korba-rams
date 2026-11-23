param(
    [Parameter(Mandatory = $false)]
    [string]$DatabaseUrl,

    [string]$AdminUsername = "admin",

    [string]$AdminPassword = "password@12345"
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
    $DatabaseUrl = Read-Host "PostgreSQL/Netlify Database URL"
}

if ($DatabaseUrl -notmatch "^postgres(ql)?://") {
    throw "DatabaseUrl must be a PostgreSQL connection string beginning with postgres:// or postgresql://"
}

if ($AdminPassword.Length -lt 12) {
    throw "AdminPassword must contain at least 12 characters"
}

$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwtSecret = [Convert]::ToBase64String($bytes)

Write-Host "Configuring Netlify environment variables..."
npx netlify env:set NETLIFY_DATABASE_URL $DatabaseUrl --context all --scope runtime --secret --force
npx netlify env:set JWT_SECRET $jwtSecret --context all --scope runtime --secret --force
npx netlify env:set ADMIN_USERNAME $AdminUsername --context all --scope runtime --force
npx netlify env:set ADMIN_PASSWORD $AdminPassword --context all --scope runtime --secret --force
npx netlify env:set ORG_TIMEZONE "Africa/Accra" --context all --scope runtime --force

Write-Host "Running RAMS migrations and creating the first administrator..."
$env:NETLIFY_DATABASE_URL = $DatabaseUrl
$env:JWT_SECRET = $jwtSecret
$env:ADMIN_USERNAME = $AdminUsername
$env:ADMIN_PASSWORD = $AdminPassword
$env:ORG_TIMEZONE = "Africa/Accra"
npm run migrate

Write-Host "Database setup complete. Deploy the site to apply the runtime configuration."
