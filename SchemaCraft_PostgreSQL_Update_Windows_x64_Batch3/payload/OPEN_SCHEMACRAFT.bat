@echo off
setlocal DisableDelayedExpansion
title SchemaCraft
pushd "%~dp0"
if errorlevel 1 goto folder_error
set "PYTHONHOME="
set "PYTHONPATH="
set "SCHEMACRAFT_POSTGRES_DEV="
set "SCHEMACRAFT_POSTGRES_BIN="
if not exist "vendor\python\python.exe" goto missing_python
"vendor\python\python.exe" -X utf8 -B "SchemaCraft.py" %*
set "SC_APP_EXIT=%errorlevel%"
if "%SC_APP_EXIT%"=="0" goto complete
echo SchemaCraft could not start or reported an error. The details are shown above.
pause
:complete
popd
exit /b %SC_APP_EXIT%
:missing_python
echo The application's bundled Python runtime is missing.
pause
popd
exit /b 1
:folder_error
echo The application folder cannot be opened.
pause
exit /b 1
