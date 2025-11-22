Write-Host "Starting AppleSnakes Dev Server..." -ForegroundColor Cyan
Write-Host ""

# Set paths
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
Set-Location "C:\Users\based\OneDrive\Documents\GitHub\miniapp_applesnakes"

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = & node --version 2>&1
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js not found!" -ForegroundColor Red
    Write-Host "Please ensure Node.js is installed at C:\Program Files\nodejs" -ForegroundColor Red
    pause
    exit 1
}

# Check npm
Write-Host "Checking npm..." -ForegroundColor Yellow
try {
    $npmVersion = & npm --version 2>&1
    Write-Host "npm version: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: npm not found!" -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "Starting development server on http://localhost:3000..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Run npm dev
& npm run dev
