@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 goto folder_error
set "SC_COPY_ARGS="
set "SC_COPY_QUIET=0"
:arguments
if "%~1"=="" goto choose_python
if /I "%~1"=="/quiet" goto quiet_argument
if /I "%~1"=="/executable" goto executable_argument
echo ERROR: Unknown option "%~1". Use /quiet or /executable.
popd
exit /b 1
:quiet_argument
set "SC_COPY_QUIET=1"
set "SC_COPY_ARGS=%SC_COPY_ARGS% --quiet"
shift
goto arguments
:executable_argument
set "SC_COPY_ARGS=%SC_COPY_ARGS% --executable"
shift
goto arguments
:choose_python
if exist "vendor\python\python.exe" goto private_python
where py >nul 2>nul
if errorlevel 1 goto missing_python
py -3.13 -X utf8 -B make_user_copy.py %SC_COPY_ARGS%
set "SC_COPY_EXIT=%errorlevel%"
goto complete
:private_python
set "PYTHONHOME="
set "PYTHONPATH="
"vendor\python\python.exe" -X utf8 -B make_user_copy.py %SC_COPY_ARGS%
set "SC_COPY_EXIT=%errorlevel%"
goto complete
:complete
if "%SC_COPY_EXIT%"=="0" goto finished
if "%SC_COPY_QUIET%"=="1" goto finished
echo User-copy creation failed. The details are shown above.
pause
:finished
popd
exit /b %SC_COPY_EXIT%
:missing_python
echo ERROR: The bundled Python runtime and Python Launcher ^(py^) are missing.
if "%SC_COPY_QUIET%"=="0" pause
popd
exit /b 1
:folder_error
echo ERROR: The application folder cannot be opened.
if /I not "%~1"=="/quiet" pause
exit /b 1
