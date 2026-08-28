$ErrorActionPreference = 'Stop'
Write-Host 'Validating the existing Cloudflare Worker configuration...' -ForegroundColor Cyan
npx wrangler deploy --dry-run
Write-Host 'Deploying to the database already configured in wrangler.jsonc...' -ForegroundColor Cyan
npx wrangler deploy
Write-Host 'Done. This script never creates, replaces, seeds, or migrates a D1 database.' -ForegroundColor Green
