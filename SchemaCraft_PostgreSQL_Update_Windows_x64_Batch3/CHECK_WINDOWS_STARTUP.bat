@echo off
setlocal DisableDelayedExpansion
title SchemaCraft Updater Diagnostics
pushd "%~dp0"
if errorlevel 1 goto folder_error
if not exist "vendor\python\python.exe" goto missing_python
"vendor\python\python.exe" -X utf8 -B "updater_launcher.py" --startup-self-test --package "%~dp0." --platform windows-x86_64
set "SC_STARTUP_EXIT=%errorlevel%"
echo.
echo Diagnostic log: "%~dp0updater-startup.log"
pause
popd
exit /b %SC_STARTUP_EXIT%
:missing_python
echo The bundled Python runtime is missing. Extract the entire ZIP first.
pause
popd
exit /b 1
:folder_error
echo The extracted update folder cannot be opened.
pause
exit /b 1
