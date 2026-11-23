$ErrorActionPreference = "Stop"

$nodeVersionOutput = & node --version
if ($LASTEXITCODE -ne 0) {
    throw "Node.js is required. Install Node.js 20.12.2 or newer."
}

$nodeVersion = [version]$nodeVersionOutput.Trim().TrimStart("v")
if ($nodeVersion -lt [version]"20.12.2") {
    throw "Netlify Database requires Node.js 20.12.2 or newer. Current version: $nodeVersion"
}

$netlifyCli = "netlify-cli@^26.0.0"
Write-Host "Checking the linked Netlify site and account..."
npx --yes $netlifyCli status
if ($LASTEXITCODE -ne 0) {
    throw "Sign in with 'netlify login' and link this folder to your site with 'netlify link'."
}

Write-Host "Initializing Netlify Database for this project..."
npx --yes $netlifyCli database init --yes
if ($LASTEXITCODE -ne 0) {
    throw "Netlify Database initialization failed. Check your site's plan and Netlify CLI output."
}

Write-Host "Netlify Database setup is complete. Commit the generated dependency/migration changes and deploy."
