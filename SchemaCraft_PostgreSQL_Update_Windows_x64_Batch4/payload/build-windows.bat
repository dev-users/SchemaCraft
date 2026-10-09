@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where pyw >nul 2>nul
if not errorlevel 1 (
  start "" pyw -3.13 "%~dp0build-windows-gui.py"
  exit /b 0
)

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python Launcher ^(py^) was not found.
  echo Install 64-bit Python 3.13 with Python Launcher enabled, then try again.
  pause
  exit /b 1
)

py -3.13 "%~dp0build-windows-gui.py"
exit /b %errorlevel%
