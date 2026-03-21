# Quick Setup Script for Local PostgreSQL
# Run this AFTER installing PostgreSQL

Write-Host ""
Write-Host "Checking PostgreSQL Installation..." -ForegroundColor Cyan
Write-Host ""

# Check if PostgreSQL service exists
$pgService = Get-Service -Name "*postgresql*" -ErrorAction SilentlyContinue

if ($pgService) {
    Write-Host "PostgreSQL Service Found: $($pgService.Name)" -ForegroundColor Green
    if ($pgService.Status -eq 'Running') {
        Write-Host "Status: Running" -ForegroundColor Green
    } else {
        Write-Host "Status: $($pgService.Status)" -ForegroundColor Yellow
    }
    Write-Host ""
    
    if ($pgService.Status -ne 'Running') {
        Write-Host "PostgreSQL is not running. Starting service..." -ForegroundColor Yellow
        Start-Service $pgService.Name -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $pgService.Refresh()
        if ($pgService.Status -eq 'Running') {
            Write-Host "PostgreSQL Started Successfully" -ForegroundColor Green
            Write-Host ""
        } else {
            Write-Host "Failed to start PostgreSQL" -ForegroundColor Red
            Write-Host ""
        }
    }
} else {
    Write-Host "PostgreSQL not found!" -ForegroundColor Red
    Write-Host "Please install PostgreSQL first:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "1. Download: https://www.postgresql.org/download/windows/" -ForegroundColor Cyan
    Write-Host "2. Or run: choco install postgresql" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# Check if psql is in PATH
$psqlPath = where.exe psql 2>$null
if ($psqlPath) {
    Write-Host "psql found: $psqlPath" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "psql not in PATH" -ForegroundColor Yellow
    Write-Host "Add PostgreSQL bin folder to PATH or restart terminal" -ForegroundColor Gray
    Write-Host ""
}

# Check .env file
if (Test-Path ".env") {
    Write-Host ".env file exists" -ForegroundColor Green
    Write-Host ""
    
    $dbUrl = Get-Content .env | Select-String -Pattern "DATABASE_URL" | Select-Object -First 1
    if ($dbUrl) {
        Write-Host "Current Database Configuration:" -ForegroundColor Cyan
        Write-Host "  $($dbUrl.Line)" -ForegroundColor White
        Write-Host ""
        
        if ($dbUrl.Line -match "password@") {
            Write-Host "WARNING: Default password detected!" -ForegroundColor Yellow
            Write-Host "Update DATABASE_URL in .env with your actual PostgreSQL password" -ForegroundColor Yellow
            Write-Host ""
        }
    }
} else {
    Write-Host ".env file not found" -ForegroundColor Red
    Write-Host "Copy .env.example to .env and configure it" -ForegroundColor Yellow
    Write-Host ""
}

# Prompt to create database
Write-Host "============================================" -ForegroundColor Gray
Write-Host "Database Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Gray
Write-Host ""

$createDb = Read-Host "Create 'restorder' database now? (y/n)"

if ($createDb -eq 'y' -or $createDb -eq 'Y') {
    Write-Host ""
    Write-Host "Enter your PostgreSQL password when prompted..." -ForegroundColor Yellow
    Write-Host ""
    
    # Try to create database
    psql -U postgres -c "CREATE DATABASE restorder;" 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Database 'restorder' created successfully!" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "Database creation failed or already exists" -ForegroundColor Yellow
        Write-Host "If database already exists, you're good to go!" -ForegroundColor Gray
        Write-Host "If password failed, update .env file" -ForegroundColor Gray
        Write-Host ""
    }
}

# Offer to start server
Write-Host ""
Write-Host "============================================" -ForegroundColor Gray
Write-Host "Start Server" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Gray
Write-Host ""

$startServer = Read-Host "Start the development server now? (y/n)"

if ($startServer -eq 'y' -or $startServer -eq 'Y') {
    Write-Host ""
    Write-Host "Starting server..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Server will be available at:" -ForegroundColor Cyan
    Write-Host "  http://localhost:3000/index.html" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
    Write-Host ""
    
    npm start
} else {
    Write-Host ""
    Write-Host "Setup Complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To start the server manually, run:" -ForegroundColor Cyan
    Write-Host "  npm start" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Then open: http://localhost:3000/index.html" -ForegroundColor Cyan
    Write-Host ""
}
