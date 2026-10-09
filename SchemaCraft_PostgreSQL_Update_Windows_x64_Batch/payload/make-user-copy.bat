@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 goto folder_error
if exist "vendor\python\python.exe" goto private_python
where py >nul 2>nul
if errorlevel 1 goto missing_python
if /I "%~1"=="/quiet" goto system_quiet
py -3.13 -X utf8 -B make_user_copy.py
set "SC_COPY_EXIT=%errorlevel%"
goto complete
:system_quiet
py -3.13 -X utf8 -B make_user_copy.py --quiet
set "SC_COPY_EXIT=%errorlevel%"
goto complete
:private_python
set "PYTHONHOME="
set "PYTHONPATH="
if /I "%~1"=="/quiet" goto private_quiet
"vendor\python\python.exe" -X utf8 -B make_user_copy.py
set "SC_COPY_EXIT=%errorlevel%"
goto complete
:private_quiet
"vendor\python\python.exe" -X utf8 -B make_user_copy.py --quiet
set "SC_COPY_EXIT=%errorlevel%"
goto complete
:complete
if "%SC_COPY_EXIT%"=="0" goto finished
if /I "%~1"=="/quiet" goto finished
echo User-copy creation failed. The details are shown above.
pause
:finished
popd
exit /b %SC_COPY_EXIT%
:missing_python
echo ERROR: The bundled Python runtime and Python Launcher ^(py^) are missing.
if /I not "%~1"=="/quiet" pause
popd
exit /b 1
:folder_error
echo ERROR: The application folder cannot be opened.
if /I not "%~1"=="/quiet" pause
exit /b 1
