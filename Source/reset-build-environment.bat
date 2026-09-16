@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if exist ".build-env\" (
  rmdir /S /Q ".build-env"
  echo The reusable build environment was removed.
) else (
  echo No reusable build environment exists.
)

echo The next build will recreate it from Packages without internet access.
pause
