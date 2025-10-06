# PowerShell script to clean ports and start development server
Write-Host "🧹 Cleaning up ports..." -ForegroundColor Yellow

# Kill all Node.js processes
try {
    taskkill /IM node.exe /F 2>$null
    Write-Host "✅ Node.js processes terminated" -ForegroundColor Green
} catch {
    Write-Host "ℹ️  No Node.js processes found" -ForegroundColor Blue
}

# Wait for processes to fully terminate
Start-Sleep -Seconds 2

# Check port 3000 specifically
$port3000 = netstat -ano | findstr :3000
if ($port3000) {
    Write-Host "🔄 Port 3000 still in use, force killing..." -ForegroundColor Yellow
    $pids = $port3000 | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
    foreach ($pid in $pids) {
        if ($pid -match '^\d+$') {
            try {
                taskkill /PID $pid /F 2>$null
                Write-Host "✅ Killed process $pid" -ForegroundColor Green
            } catch {
                Write-Host "⚠️  Could not kill process $pid" -ForegroundColor Red
            }
        }
    }
    Start-Sleep -Seconds 1
}

# Verify port 3000 is free
$port3000Check = netstat -ano | findstr :3000
if ($port3000Check) {
    Write-Host "❌ Port 3000 is still in use. You may need to restart your computer." -ForegroundColor Red
    Write-Host "Processes using port 3000:" -ForegroundColor Yellow
    Write-Host $port3000Check -ForegroundColor Gray
    exit 1
} else {
    Write-Host "✅ Port 3000 is now available" -ForegroundColor Green
}

Write-Host "`n🚀 Starting development server..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Blue

# Start the development server
Set-Location $PSScriptRoot\..
npm run dev