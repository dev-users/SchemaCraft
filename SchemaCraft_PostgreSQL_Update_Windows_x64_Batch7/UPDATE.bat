@echo off
setlocal DisableDelayedExpansion
call "%~dp0UPDATE_WINDOWS.bat" %*
exit /b %errorlevel%
