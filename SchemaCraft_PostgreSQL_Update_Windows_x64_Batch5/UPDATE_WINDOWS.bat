@echo off
setlocal DisableDelayedExpansion
title SchemaCraft PostgreSQL Update
pushd "%~dp0"
if errorlevel 1 goto folder_error
set "PYTHONHOME="
set "PYTHONPATH="
set "SCHEMACRAFT_POSTGRES_DEV="
set "SCHEMACRAFT_POSTGRES_BIN="
set "TCL_LIBRARY=%~dp0vendor\python\tcl\tcl8.6"
set "TK_LIBRARY=%~dp0vendor\python\tcl\tk8.6"
if not exist "vendor\python\python.exe" goto missing_python
echo Checking the bundled updater. No application data is changed by this check.
"vendor\python\python.exe" -X utf8 -B "updater_launcher.py" --startup-self-test --package "%~dp0." --platform windows-x86_64
if errorlevel 1 goto startup_error
echo Opening the graphical updater. Keep this console open until the updater closes.
"vendor\python\python.exe" -X utf8 -B "updater_launcher.py" --package "%~dp0." %*
if errorlevel 1 goto startup_error
popd
exit /b 0
:missing_python
echo The bundled Python runtime is missing. Extract the entire ZIP before running this file.
goto failed
:startup_error
echo.
echo The updater could not start or reported an error. The details are shown above.
echo Diagnostic log: "%~dp0updater-startup.log"
goto failed
:folder_error
echo The extracted update folder cannot be opened.
pause
exit /b 1
:failed
echo No update is reported as successful by this launcher.
pause
popd
exit /b 1
