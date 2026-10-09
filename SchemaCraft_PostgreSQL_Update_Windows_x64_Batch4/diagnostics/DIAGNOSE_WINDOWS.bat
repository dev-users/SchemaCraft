@echo off
setlocal DisableDelayedExpansion
title SchemaCraft migration diagnostic (read only)
echo SchemaCraft migration diagnostic - no database or migration changes
echo.
set "DIAG_UPDATER=%~1"
if defined DIAG_UPDATER goto check_python
if exist "%~dp0vendor\python\python.exe" set "DIAG_UPDATER=%~dp0"
if defined DIAG_UPDATER goto check_python
if exist "%~dp0..\vendor\python\python.exe" set "DIAG_UPDATER=%~dp0.."
if defined DIAG_UPDATER goto check_python
echo Paste the extracted PostgreSQL UPDATE folder containing vendor\python.
set /p "DIAG_UPDATER=Updater folder: "
set "DIAG_UPDATER=%DIAG_UPDATER:"=%"
:check_python
if exist "%DIAG_UPDATER%\vendor\python\python.exe" goto run_diagnostic
echo.
echo Bundled Python was not found. Choose the extracted UPDATE folder.
echo No system Python is required. No report was collected.
pause
exit /b 2
:run_diagnostic
if not "%~2"=="" goto run_selected
"%DIAG_UPDATER%\vendor\python\python.exe" -X utf8 -B "%~dp0diagnose.py" --updater-root "%DIAG_UPDATER%"
goto finished
:run_selected
"%DIAG_UPDATER%\vendor\python\python.exe" -X utf8 -B "%~dp0diagnose.py" --updater-root "%DIAG_UPDATER%" --selection "%~2"
:finished
set "DIAG_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %DIAG_RESULT%
