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
$netlifyCli = "netlify-cli@^26.0.0"

function Set-ProductionFunctionVariable {
    param(
        [string]$Name,
        [string]$Value,
        [switch]$Secret
    )

    $cliArgs = @("env:set", $Name, $Value, "--context", "production", "--json")
    if ($Secret) { $cliArgs += "--secret" }
    $null = & npx --yes $netlifyCli @cliArgs
    if ($LASTEXITCODE -ne 0) { throw "Failed to set $Name in Netlify." }

    $savedValue = & npx --yes $netlifyCli env:get $Name --context production --scope functions 2>$null
    $savedText = ($savedValue | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $savedText -or $savedText -match "^No value set\b") {
        throw "$Name is not available in Netlify production functions."
    }
}

foreach ($name in @("JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "ORG_TIMEZONE")) {
    $current = & npx --yes $netlifyCli env:get $name --context production 2>$null
    $currentValue = ($current | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $currentValue -and $currentValue -notmatch "^No value set\b") {
        npx --yes $netlifyCli env:unset $name --context production --force
        if ($LASTEXITCODE -ne 0) { throw "Failed to reset $name in Netlify." }
    }
}

Write-Host "Configuring production function environment variables..."
Set-ProductionFunctionVariable "JWT_SECRET" $jwtSecret -Secret
Set-ProductionFunctionVariable "ADMIN_USERNAME" $AdminUsername
Set-ProductionFunctionVariable "ADMIN_PASSWORD" $AdminPassword -Secret
Set-ProductionFunctionVariable "ORG_TIMEZONE" "Africa/Accra"

Write-Host "Environment configured. Deploy the site; RAMS initializes its schema on the first API request."
