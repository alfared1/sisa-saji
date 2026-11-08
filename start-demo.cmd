@echo off
setlocal
rem Sisa-Saji: double-click to start the full demo (database, app, worker).
rem Stop with Ctrl+C in this window, or run stop-demo.cmd.

cd /d "%~dp0"
title Sisa-Saji Demo

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [demo] Node.js tidak ditemukan. Pasang Node.js 22 LTS atau lebih baru dari https://nodejs.org
  echo [demo] lalu jalankan start-demo.cmd lagi.
  goto :error
)

if not exist "node_modules\next\package.json" (
  echo [demo] node_modules belum ada, menjalankan npm install ^(sekali saja, beberapa menit^) ...
  call npm install
  if errorlevel 1 (
    echo [demo] npm install gagal. Periksa koneksi internet lalu coba lagi.
    goto :error
  )
)

call npm run demo
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo [demo] Demo berhenti karena error. Baca pesan di atas (lihat juga README.md bagian Troubleshooting).
pause
exit /b 1
