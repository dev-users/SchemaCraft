@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PACKAGES_DIR=Packages"

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python Launcher was not found.
  pause
  exit /b 1
)

py -3.13 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) and sys.maxsize > 2**32 else 1)" >nul 2>nul
if errorlevel 1 (
  echo ERROR: 64-bit Python 3.13 is required.
  pause
  exit /b 1
)

if not exist "%PACKAGES_DIR%" mkdir "%PACKAGES_DIR%"

echo Downloading the complete Windows package set...
py -3.13 -m pip download ^
  --disable-pip-version-check ^
  --only-binary=:all: ^
  --dest "%PACKAGES_DIR%" ^
  --requirement requirements-build.txt

if errorlevel 1 (
  echo.
  echo ERROR: Package preparation failed.
  pause
  exit /b 1
)

echo.
echo Offline packages are ready in:
echo %CD%\%PACKAGES_DIR%
pause
exit /b 0
