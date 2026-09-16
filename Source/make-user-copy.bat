@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python Launcher ^(py^) was not found.
  exit /b 1
)

if /I "%~1"=="/quiet" (
  py -3.13 make_user_copy.py --quiet
) else (
  py -3.13 make_user_copy.py
)
exit /b %errorlevel%
