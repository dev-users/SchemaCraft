@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "BUILD_ENV=.build-env"
set "BUILD_DIST=.build-dist"
set "BUILD_WORK=.build-work"
set "BUILD_SPEC=.build-spec"
set "PACKAGES_DIR=Packages"
set "BUILD_ICON=%TEMP%\SchemaCraft-icon-%RANDOM%-%RANDOM%.ico"
set "BUILD_PROBE=%TEMP%\SchemaCraft-build-probe-%RANDOM%-%RANDOM%.json"
set "BUILD_SCRIPT=%~f0"
rem The build's driver selection is private to this setlocal environment.
set "PSYCOPG_IMPL=binary"
set "QUIET=0"
if /I "%~1"=="/quiet" set "QUIET=1"

echo.
echo SchemaCraft - Windows build
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python Launcher ^(py^) was not found.
  echo Install 64-bit Python 3.13 with Python Launcher enabled, then try again.
  echo The private Python supplied by the updater runs the app; EXE builds need the full Python installation.
  goto :failed
)

py -3.13 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) and sys.maxsize > 2**32 else 1)" >nul 2>nul
if errorlevel 1 (
  echo ERROR: SchemaCraft requires 64-bit Python 3.13 for this offline package set.
  goto :failed
)

echo Checking the sealed PostgreSQL 18 runtime...
py -3.13 schemacraft_postgres_runtime.py verify-runtime --runtime-dir "runtime\postgresql" --platform windows-x86_64 --execute
if errorlevel 1 (
  echo ERROR: A complete, verified Windows x86-64 PostgreSQL 18 runtime is required.
  echo Prepare it using prepare-packages.bat /postgresql VERIFIED_RUNTIME_DIRECTORY.
  echo See docs\MANAGED_POSTGRESQL_RUNTIME.md. Existing releases and data have not been changed.
  goto :failed
)

echo [1/6] Assembling the modular frontend...
py -3.13 build_frontend.py
if errorlevel 1 (
  echo.
  echo ERROR: The frontend source could not be assembled.
  goto :failed
)

echo [2/6] Preparing the application icon...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$lines = [IO.File]::ReadAllLines($env:BUILD_SCRIPT); $start = [Array]::IndexOf($lines, '::BEGIN_ICON_BASE64'); $end = [Array]::IndexOf($lines, '::END_ICON_BASE64'); if ($start -lt 0 -or $end -le $start) { exit 2 }; $b64 = (($lines[($start + 1)..($end - 1)] | ForEach-Object { if ($_.StartsWith('::')) { $_.Substring(2) } }) -join ''); [IO.File]::WriteAllBytes($env:BUILD_ICON, [Convert]::FromBase64String($b64))"
if errorlevel 1 (
  echo.
  echo ERROR: Could not prepare the temporary application icon.
  goto :failed
)

if not exist "%PACKAGES_DIR%\" (
  echo.
  echo ERROR: The offline Packages folder was not found.
  echo Expected location: %CD%\%PACKAGES_DIR%
  goto :failed
)

py -3.13 schemacraft_windows_build_check.py --wheelhouse "%CD%"
if errorlevel 1 goto :failed

if exist "%BUILD_DIST%" rmdir /S /Q "%BUILD_DIST%"
if exist "%BUILD_WORK%" rmdir /S /Q "%BUILD_WORK%"
if exist "%BUILD_SPEC%" rmdir /S /Q "%BUILD_SPEC%"

if exist "%BUILD_ENV%\Scripts\python.exe" (
  "%BUILD_ENV%\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) and sys.maxsize > 2**32 else 1)" >nul 2>nul
  if errorlevel 1 (
    echo Existing build environment is incompatible; recreating it locally...
    rmdir /S /Q "%BUILD_ENV%"
  )
)

if not exist "%BUILD_ENV%\Scripts\python.exe" (
  echo [3/6] Creating the reusable local build environment...
  py -3.13 -m venv "%BUILD_ENV%"
  if errorlevel 1 goto :failed
) else (
  echo [3/6] Reusing the local build environment...
)

echo [4/6] Loading requirements from the offline Packages folder...
"%BUILD_ENV%\Scripts\python.exe" -m pip install ^
  --disable-pip-version-check ^
  --no-index ^
  --find-links "%PACKAGES_DIR%" ^
  --requirement requirements-build.txt
if errorlevel 1 goto :failed

"%BUILD_ENV%\Scripts\python.exe" -m pip check
if errorlevel 1 goto :failed
"%BUILD_ENV%\Scripts\python.exe" schemacraft_windows_build_check.py --dependencies
if errorlevel 1 goto :failed

echo [5/6] Building SchemaCraft.exe...
"%BUILD_ENV%\Scripts\python.exe" -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onefile ^
  --windowed ^
  --icon "%BUILD_ICON%" ^
  --name SchemaCraft ^
  --distpath "%BUILD_DIST%" ^
  --workpath "%BUILD_WORK%" ^
  --specpath "%BUILD_SPEC%" ^
  --paths "%CD%\vendor" ^
  --collect-all bcrypt ^
  --collect-all reportlab ^
  --collect-all pypdf ^
  --collect-all PIL ^
  --collect-all psycopg ^
  --collect-all psycopg_binary ^
  --collect-all tzdata ^
  --copy-metadata psycopg ^
  --copy-metadata psycopg-binary ^
  SchemaCraft.py
if errorlevel 1 goto :failed

echo Verifying the frozen PostgreSQL driver and native libraries...
"%BUILD_ENV%\Scripts\python.exe" schemacraft_windows_build_check.py --archive "%BUILD_DIST%\SchemaCraft.exe"
if errorlevel 1 goto :failed
"%BUILD_DIST%\SchemaCraft.exe" --verify-build --runtime-dir "%CD%\runtime\postgresql" --report "%BUILD_PROBE%"
if errorlevel 1 goto :failed
"%BUILD_ENV%\Scripts\python.exe" schemacraft_windows_build_check.py --probe-report "%BUILD_PROBE%"
if errorlevel 1 goto :failed

copy /Y "%BUILD_DIST%\SchemaCraft.exe" "SchemaCraft.exe" >nul
if errorlevel 1 goto :failed

echo [6/6] Creating the clean user package...
"%BUILD_ENV%\Scripts\python.exe" make_user_copy.py --quiet --executable
if errorlevel 1 goto :failed

call :cleanup
echo.
echo Build completed successfully.
echo Executable: SchemaCraft.exe
echo User package: release\SchemaCraft-Windows-User
echo.
echo The build works without a data folder or builder-auth.json.
echo SchemaCraft creates runtime data files when it first starts.
echo New user packages start a private local PostgreSQL database automatically.
echo Existing Excel workspaces require explicit verified migration before activation.
echo Builder access remains disabled until builder-auth.json is created.
echo Run set-builder-password.py whenever Builder access is required.
if "%QUIET%"=="0" pause
exit /b 0

:cleanup
if exist "%BUILD_DIST%" rmdir /S /Q "%BUILD_DIST%"
if exist "%BUILD_WORK%" rmdir /S /Q "%BUILD_WORK%"
if exist "%BUILD_SPEC%" rmdir /S /Q "%BUILD_SPEC%"
if defined BUILD_ICON if exist "%BUILD_ICON%" del /F /Q "%BUILD_ICON%"
if defined BUILD_PROBE if exist "%BUILD_PROBE%" del /F /Q "%BUILD_PROBE%"
exit /b 0

:failed
echo.
echo BUILD FAILED. Review the error above.
call :cleanup
if "%QUIET%"=="0" pause
exit /b 1

::BEGIN_ICON_BASE64
::AAABAAcAEBAAAAAAIAAiAgAAdgAAABgYAAAAACAAeQMAAJgCAAAgIAAAAAAgAPAEAAARBgAAMDAA
::AAAAIAAgCAAAAQsAAEBAAAAAACAAuwsAACETAACAgAAAAAAgACEcAADcHgAAAAAAAAAAIACKLwAA
::/ToAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAelJREFUeJyNkztrVUEUhb+9
::Z8658QEiFv6eiGBjY5E/IvZp7SytFMHSVy/kFygEoiKChVETgmJikmu858ydvSzmYGERM82GYa/H
::rMXYnZdHG3l2brWMIzIzBAFIABAh0qzjy+Yndj8s8NkM1Rr4DGl8mr2/cK2UAWGE4F+CKjDBshbK
::4gcpX0WBKwoRuuXLMkyrpx+zhKliyyMMYe16cDOzMxFg4F2zWE/aBPOzgEFgBpbA8nRVAJH/rzzt
::yzFLTdNt8nQGggYW40kBT82FJjeCU58gCU+JYT5w/P03qesAb2AcAVlq3UlTLNOUwJODw87WHmUA
::7zKS04o1g1jm3GewBogJHWrqw3zgy9Ye+19/kWYdigRmSJKlBHXYybtvtlFUhBMYyAiMxXzJ8fcT
::xgWkvkea2m82Zd676v5G3vu4IIafSIHICG9klvDckftEbbanQkPmHXU8HDV+u5/zyjnU90Q5mnJI
::jURO4EipYTWlipdu5XK/+PH27ubjm+9dtQoBfhHRqvlrtyUtRUioWuqsP3+lHw7eP3/9aHV9bU0p
::e+5NIcyEWQdRcIzAIRwzLKUEllIZD+fD/va9Vw+vryPxxCCX+c6LNLt0o5aFSdgkSZWBTAFDRP2s
::5XxjebD14NWz2++QjPaF9Ad1KCtwHiSFngAAAABJRU5ErkJggolQTkcNChoKAAAADUlIRFIAAAAY
::AAAAGAgGAAAA4Hc9+AAAA0BJREFUeJyllk1rHVUcxn/POWduY9NUXPQT6Pcofoi404VQBDddFty4
::kSIo7l24cFcMQsGFWBdujRF8adAiBTUptHmPvS/NvTPnPC5m7r1JU4UkA8PM3fyf1/Ofq1tf798M
::i4sf5FwuO1sIGcDg9jF7BygG28RexcHGFg9Xd4m9KxQ32IBtkxxi3Ktifjc1sfdRKLFqmsYg2SeH
::vhgASoE6F8bDXRIVRQmXAkbFtUOqro2Pxp8EYqpKPUaSBJzpVkAybvaRayQhgYRcxs721YCLkTj3
::pYgMrv8BNx00tDDKgXNPNyBEAAWEoBmeBDEK56c+JRqAgNVxLUeIPCNxQQDBVEEH1IJMmCpMF56v
::FgCrczsAQp1VFwJwnvZpGuXx3wH5AhZJMB5NMAHNmIe5IgV8fgXCudDfHhJC7IJuG2XUDnfbpLMr
::sIlVZLA3oL/zjFAlbCGFrjNdHt11JgW2UQi4ZB79uoUdCF17Ch2IwbjLpDTJ7Yb6z/0zfxexSuSc
::+euHDQa7E2IvUtwGLALFczItWNlPqVd1AP5fgOLCcK/P5i9P6O9OiJc6axAmdstwiqCiUAW5/i0d
::PtoCG0udPE2tBkQuMBlOeLozor89IudA7KUuxGmgp7wULir14Jv059oOnhx2bNv03bXCbltRSkAh
::ElIixoA7W7BmhI5PD6mnPD44qI/+uJviwlVc9fDkkIJgJrdthRGxe7ZxHVsJzzNvi5BTbyk1o83P
::1u/c2AouGdSD9DLzLdgqwB3L7p4fJJ22BXDJJVaLaTLYfDI8+P5D3ndIiPYzFXooXcXNaL5Tju2W
::2Qog4BdMt0sO6SU5D2n69996cPe9veXqtRiYcTGogrR44rjPWM+Gn6Jt202sliJlpPH+j2/+fOft
::b5eXv4grK2/kJCUV1277ZlCEcAlK/dwktSxsoGDLWChdDlVaSJPB3xvN7uqNn768ee/69e/Sysrr
::DUAq9WCQFq5dyc2z+cdNPQgFnOcWWeB27UuBQJDzmGa89bg+ePz5099vf/xgbW1vedlxZUXNlFaq
::D++/w9Krt22/UnIjI9l2W8HSHjKY/iWhOExMs+16tO7J9r3Bw0+/Wl9d3QJobVE+rvtfeKftICNi
::680AAAAASUVORK5CYIKJUE5HDQoaCgAAAA1JSERSAAAAIAAAACAIBgAAAHN6evQAAAS3SURBVHic
::tZdLi1xFFMd/51R1ZzLJkET9ALoOZOHalW4ElzIuRBf6BVwIunAxtivBnSBoUCEgKs5CA7oRFeMi
::AaPI5IUOJs4YE2KSmem0/Zi+jzouqm7f7s6YqOkpuFTfpu75/8/7lLx0fP2wX3jgGM49XJYlmAiA
::pQcb+52WpZeJ/w1QJev1+OXbdUpbAMp4xmx00JAg2iydll8+eL8958s9Bz708/NHBn/1AyLKtPBp
::ArWsJJyJlZXQ720QBMTvwyxMETANYUBj/r4nVq+13/S6Z/7IdncQVESnZP2vJQgqihVbiAroPFBO
::nFFFimEnFMEeUysKE0RngF0xABFAsfwWhAE7iRcRRaxQJPp8tksiqAhWdKDcTqQml5mInz04SWOp
::n7KXSDWZDGeYnenH8ZGosUiMa1EoB2B5IlWv3bEAMQYECDEsozvCMKlcw+6KBUwUQdKuo6AUEQg5
::WJ0Vu+aCCXDTZPkUnFaAhVi7doNApCAjzSO4joIzJp4h2AwJpOAOJZhNa165IRIzoouINpoVviEq
::5IOMsgiI3q45I9dEVxgzzgJR6G70sFBZoPK51BYwIaSilBw0I3ARyqygfbWLepfMP+7z9EyV5ZkQ
::sGC4pqP9xxb99jASqDSWaPZK3+mGd+8EzFDvyPpDrp6/gaqn0jZ299rn9TekM6G4JwIWDHUOrGTt
::9GWGPUN90lYUq8wvMt0CEFEIofPfCFicbixNIY05T5lnXDy5RufaNq7psCrwRr7X24YWEwmowyxf
::96JaSx/bxkFr2qnCK4S8YGPtJlfOXWfYNVyzQQhM5HvYwee1KIFy8KPPer00BtpoBKu2+C7p3Qgl
::ZP2M7mafW1e79LaGiHpc0xEsZoKN5fs/oQtomXctFNe/8qvf/YblHcBhIpiludRktEMUbEEoCiOU
::ijjFNRuYCWYx4EIKrjsVWDML6vdJvv3narb90SlvcoCgiuUdjBQ4CIFJUybfoV5RnwiNRXtAYqzZ
::XcMqqG96tjePXVhezjwSkMZCSope6mSCJEFVGlVgIKnW110vWiCRvsNkG7Xfq1n38ma/e+IoZik5
::LYBbQPz+5HJN/tQ6jaoON9ZYYhmR2vd3GatFtHTOa+hefOXnz17fWHwKHbNXADePuP1J88kSKlKD
::x9ZeE/l3TdVyP3ewMdxa+fynj59+e3HxE7e8LOVUMzJwcxGgHCazp65mY5pP1/Y7am4AuZ871Mja
::588V6+8+u7Rk2moRYKdSbAY6B27vCEzQlKoykWo7FZlJWaUZrvBzBxtZ++yZbP2dx1dOHG+3eBUQ
::A/ARcXpoN9BmBAl5Csqobaw1MRBHJd0mvzWzAC5IY7/3UvrhjZOf5mdefH5lZb3N0pLSaoXqtBdx
::EkIIYqGqOGkFEAdiiJUx7cxitI8uhXXVstiWTMQ739yrEDTrXLpS3lp57YflF44CTIMD+Lz3+zdz
::hw4/WgwHt2szmhoDmI3qg0zcViXdBxELBeXgJnl/c6Xorn3QP/vy+xcudDZZMqWF0ZIJcAA/XH3v
::GXvoybe0eeiRUOTOzOrreYia2si0gmFj13MzQzNC3raifynk7dPW+fXr77944xRQACwufuKWW1JO
::A1frbx3LYcTmJWGzAAAAAElFTkSuQmCCiVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmH
::AAAH50lEQVR4nM2azY8cRxnGf29V9ew4iY1l8RGhSByiXLhw4IAEQo4lhJQTEmQj8Q8gBAeQIkVR
::JFj2mgMXQCAkkDgQiEcJCBQJJwi8EEhCgrz+2hjHWXltJ/HXrnfXM7MzPd31cqjqnu71eD1j8E5K
::2p2Znurq53nr/Xje2hWAZ14895g98PFnc+ynQQRFiEO3vRZvRl0v32+/V+vXVMEllovHlrl6XnEz
::Dp/rtvW0Nj8MUcR1mzPm6Cf3Zt/9xTOPnJOn/7DyZfZ+7I8kexrpVldBRO8A9H8noLhGwvk3TnD5
::bJtk74N4r9vuGT6ofk1Imh9hxrTffegT8qgbuL0/dsmexmCrm4uIZZeGCBhjEd9FBmuY5ACo3moY
::qsYKjpH11gfa3P/wyvubc0aS5iPZVk9FzK6Brw8LfgtN1ya4R6wfdLWX6hcMIooMfX63h4iARBKD
::DRgLigoioh5nxrzjHg0JOUMBHPgtyNYnWsHcC1hjDwn+LSUMg+Z9NNsce4npEtAI3hROIGAM+BSy
::9lhLTJGAhlQkEonE90ggpQPIO3dcZbo7gJQ/agIB0RgXGNRnIS52GFMmAMFtouVL8AIYRAzoziSm
::SqDmNgV4KcATg9yAevC9kWtMlUCosNssrybkdQFVMySpHvHpLWtM3YUCQG61fAHehDmCQfHBpSrj
::Q+FCKgbRutsUxFABja4lwZ2EIYkPQSELAMuEpBXw1QwFiAbpEdSyB6ZMwPugZKpuQwm++h6o7FbY
::OwX8tAgIqJKnGixatbypgo+1AYnzTCx6BHfC4KYCX8BnOWm3jxgDakpeaBU8MVVJTKfR9nHLlCm5
::kBjDYKtPv5Mh1g7BV4O3CODSbQrpHdKtxim7T0AVY4X2Woe0p5hSyAXLa6WwSZFaS61kYtAPl5vC
::DoSidOPSRpAKNctXsk/1bEGC3NjecwO7HAOqGGfp3mizeWUL27CxmSnyPKEqI/X8IibMG8FgV3dA
::CXL/8n+ukmfBpwsZUddD0efjbx1l+rCi7BoB9eEo5calNdYutrGJQz2xSEmZGusBu1PHK6jm6a4Q
::UFVMYum3O1xY/AAxSQS8HXy9ubmt4UEDQe3ccwLqg9/nacry6ysMuoIxMZsgiG4DX6TKHdCHkxQD
::3l+7dwRUwwncTEK2tcW5V5fprHlsYksZDYAJ4EWHbqO3dZsaC8h7y//3LFQc/xlncQY23rvOyrHL
::9DtgGxavBXit5/WY83e0/PAhgubkvn3SaeU4r8hTk5+NBj8WY7A2gOuut7ly9hqrKzeBBNcwJfhQ
::ZKMoi+B1XPAoGGvytJ1p/9qbzjVcZctCsp2UgKqiWU661aOz1mb9vU02LnfJBopNGpUD2nACVFTb
::cGkCywOqeJM0Tda/sZyd+N1pd/HYO6gfxGYhThIJcrvQ6xGpFvokglEU7w35QEk7fXqdjEEvSCyb
::WFwSgjEEaCXblBaQYZEae4g3tiGS3fzz0lIrdddWFN/fAD8g9G8SrRoVX8wOWvam0QUoSn0hAQyI
::xTWkUAsBWPWeCF6K9Saw/BC/GJ9uSL75zmEA52aaaONBNF0FnwXrVxsLrYOtgY+dVCAcwKgWWxX0
::S83yUgQswViTgkdzm9xv0s1zJxd//+1XURWj6gNgdwCVUB2JQNRrCPiinKtGkIAPrhQ+V/R8tRmp
::FinqqXJy8MFwQi6+++4Pgfzgo0etKb5CLOIOICYppw6tJkWeCTk7HBXEnRgeg0ixc5UetpbXpWKM
::ScGr9y55wKbrZ08PTn/jOebULCwcyiqFLJJI9iPiYlNRtSKx4JiR36GmbAHLjqSwPGNW2NvDR0zD
::a7ZBtrb45NIS6exSq9zv2kQwkOwH47bpElOCD1asgx+2epSFqfxcVNi7Ag+oZK5xn+uvvvXLEy89
::fWR29rBttZ7IRxCITxcDdl/YCTT6r9QtX7Z9sZMyhRCDouGuyQMdcpkIu/rczuxz/etvvp2eeuo7
::c3NqWq1ZX3w/gkBMPRhwD4C4SmyGDCVl51Q9+pMybnYsUhPsgqrPbWOfzTaWbvQvHv7q0tL19jw/
::IEbX7QhUn2TA3Q/GBlDF6RkMLV+NBVNxmzIG7m6o+twm+2x+80ynd+HFr5xa+M2Z2dnnLfPzvjrv
::Dmo0krD3AZboEwyDdHSqvLsKWzzSoyqZa+63+cbJ6zdXfvXYyb/87O8HD865wu+rYww1GiuPbYLv
::F+V1RJEC8ZRucxdFCvXqcU2cta53dWGxv/zzr7/92sKZgwfn3MLCfDbqrgnktICZiZJD6/JABFEt
::T5gnA6+oqkcaapt7bN45T2/1jZ9uvfDkU0vQjhlnJHgAp3nfY2Yq8vAOJCQBzZC71vNaVHSPWI8k
::1jVmjO+vkl557V/pB0e+d/yvv34ZBOa+b1rzt7pNDdGXvvWnvzU/+tkvpr31gfjcRZuUQIb/p0Dt
::gpKBhsIkMed7v31Oca8EJSJGRUWwiTEmQcgYtC8wuHnu9cHqv3+0+PJPngfy2Vm1rZZ4xthL17v0
::0jchPzJz4DMP+dxH7xiHAFFyUmYeEyU4kUhxXTVqcE3xgzaDzcuZ9tfO+P77r6TXF184fvS5fwRz
::Gnj8a7bVkh2tXh0C8PlDhx5ufmp2Xtz+z3n1e2r/dKH114LB8GOYW8pnoAgIxecgfe+zVLLeBc3a
::y1l6dTFbO/nW8X++cgriXyrEMPv4b22r9cRYVq+O/wKSPyEVXjGoygAAAABJRU5ErkJggolQTkcN
::ChoKAAAADUlIRFIAAABAAAAAQAgGAAAAqmlx3gAAC4JJREFUeJzVm1uMZUUVhr9VVacvcwEFjBgl
::MfGBxPBgTIyJ0YwJifHNB20STXjyQR6Mb0bQSDMRicbEN2MiGqLGqBzJiJqgo4I4DhAVZGboGYYR
::hrkww9A0fe9z2XvX8mFX7V379OmZvgW766H77MvZu/6/1vrXqlV1ZFLVHBTx3zh05k57/U1f9djb
::jG2JooAAgDb+NT/rkHNXue+q9wzep4qxls7CPGeOXgKzHyjQIe/UIScb/VVRY+3s+Kh7/J3j3fsf
::uufWY5OTagTg7t+d/87Yu2/5WqenZP1u4wVrPnDgg6eiC5/cJ9o8J8m1eG7V+0gJcHTmZzl1+Bi4
::94AdQX39tnURIKBeQQyt0b3sG/XzN1xXfO7hb37gL/K135z9wuj73v+LpeV+gc9FRMwg2PUQMPTa
::GtcH77s2AXO8ePg5Cj+CGXsXKqOgfv0EJO/wqrm4PW5Pqz9zy83yIZON7b23l+FL8MYM6eeOaB4D
::qmjvTfA9mra0/iYiTvOVvOf33Hjxir/LSGv81rzXMzsZfNVEAEWzt8D32TQJYHyRaafrP2HEOh1u
::oDurCSAYEAPqSxI0Y7MkAJIXutds5QlvbzOhp3V00mx2ayQIuvPNPjaJwihAGDf1NQmyORJ2DwEA
::SOkCybEokM2B35wl7CICBAlKUOMUVAQV0HxxUyTsKgKQoANa0oFEMkxpCcXShknYXQRABV4HwQcN
::UL+8IWHcPQRI/NcETwpepBRJ3wHNWQ8Ju4cABYaAlwHwUllKBwgkXCXN2TUElFOUdYAXQKTM/Ysu
::aF5eX6PtGgKCARB9PmKqwEfLEFBirgBoF6FgLXfYNQSUiCURPFlt9gKKQVTiLeWfog8UQx+7ewgA
::0hxAGTT7GnyaJ4iGA58xTAx2DQGidSKk0RoS8AyCF0HUJPcTSEhLN+DePghbbAbwwee9VNZdi2IT
::fDzW+mSYSxUNO9glFhBGPpq90DD7q4IPTEm8JgJ4JNCwKwhQr/gQBhL3bvp8NAmtQZdpcwreBBKh
::JGFXEKCABW8bZr9q5COc6O8JeAnXFEIIraHvaAIUECNk3W4JtirfJKEOEsGrj9ORVzElV2mZWEon
::2NEEACBCb7mP977ENcTnRU2VAVYaAInZB/BCeRwzRXYDAerpzHcQsaiuDnUE8FWmqMm1FHzqIkkY
::2NFhUMRQZDkrs10wNpysrg6Ar81eg5uoUrtBNPuBXGjnWoAqxho6C8t0FnKsTQlIzB6CGyRqH2A1
::Qt8Q8LCDCVBALMy9NkeRC9IQwNWCV31OJz1xzsBw8OXTdmgTY8g7XWYvLGKdJS7WRg3QKHoDI59m
::fqxh9mnbkQSoKrZlmDk3Q3fRY1yI5pXPy2rwUfCA9YKHHUqAMZZspcOVl2YwLVeC0DJuV+ntBsCv
::WQ9RlR1HgKpiWnD55GV6y2Bskt4GMZPBJEep6wRVLnCNFwmo5tmOIkC94kZbzJ6f5o2XF7AjrXIV
::vJkDJwlNKI1BAp51LXUKghFZ2DEEqCp2xLEyO8e55y4jZqRR/akMPMb4MMrNWd7wvQbDm+CLfHlH
::EKBesS1Hb2mJV54+T545jJEquiUVL4aDL2GsF7yKaOkm2YX/eyYYzb4zN8/LT52nu2xwzlDE9LWR
::3gbwfvPgw1NBPT5ffvX/RoCqgjG4McvshTc49+xl8p7FORP2DkUxi0Ndz+UH1X8T2xuMzztotnDy
::7SVAQzojBjdq6Xe6XDpxmStnFhDTwjpJwJOs+tQCWEbAen6/cfCqYkak6M8t5ounT7k1t4Rd49S1
::r0mZvSWzM+MsYoW822P6zAyvvzRDd1ExrRGEsGssAvaRg0QAq+thSWwzG1sUNW5Uik7/9Mk/3H3R
::iRs0gq0TIPGCxEqup8hzVuaWmL80z+zFRTrzOeIsbsShPklt40jX1Y7kwcHnt7CpRxEvYo3P3noa
::8K43P5sUD2tAOnBcvTSc1xiPQ5yujgHvFVVL3u3RX+6xstBjebZDZyGnyATrLG6shffl91aBDyVL
::bSQ0mxO8wSYixudLsHLxjwDupX+cQ7N5Ylas6fJzOFbKpSeNdSUNs6xKoWOCUp7zXkAN6gMZGBCL
::tS1ao8F6PYjGUBdz/UiiDPj3lgSvbupV3B6TL5+/0pn6+REQHPZG8K0mCSGPrvfkJFPKdJU25OjR
::Q311LMQNXRImLRp6rxEQw8FrjPNeEw2I63xbAA+omMK6EZf133j09OmnFiceVmuggNZ+ZOR6EB/8
::LE47wqKjAURLGqrl6QillGYVrcQ7fj+OdC2E4U+a4Ug68msnOVvfyaeIOFOsvO7z2ecfBKB9Rxxy
::D3Y/0noH4BPWJf1+ZYYRet3JQJcmZekAtFq+ogTYnNjE5w4Db2C75mqlNRe2NW7ypVf+9sJjD/x7
::clJNu90ukjd4sPsQd11SRCTxc1PX3qjNvgJf7eMrz0fdqM5JWtCMShpL28Nz+y37fIVfEWnhe9P4
::uWe/DXDyZDu8udGCJbj9xN5IGPlq1FQw1Zy7Hvkau0TniVwQ6/iVz4f/5R3DRj4StHXwoRW2tcdm
::syceO/7Ydx8vR/+OAoZWhT3YvWVn8iVUYjFS6kVJYv8GipNaRorkkOhKDfBpbs8g+KCt2wW+VH7y
::xTO97vSRr4LKyZN3VDDWSIUV7N6y48VySD6SIkTAkBYnNZp9xCeUbhFHXgfB12I4CH77Rl5RcYUT
::77ozT3/r1BM/npqY+JRtt9vVbomrqIwHO45x+wZ8MwEfPKGhC/FcCn7VyJciW4d9U7nONpo9KIUb
::2eu6r//9meO/+/oDExMP23b7jvT3HNeqCSpqxhC7J3R8iOBJYvYJ+NWCF3ky1WtTwQOaP3rYYlPv
::vWntM/2Zf831LvzqTpCs/cGpVTOIa8cZVTBj4MZD7S1doo7gpQ5rieBV1dtE8BqhdWA+31SYLTQt
::1Izs12LxRbLLj37+5DOH/zsx8WvLwYN+8NZrEiAx6ZExxI5T+YNIuVZXRYPycavUPhG45na1Erzq
::NgoegBaK2+/pnrfdS7//0vG//vSPBw5Muqj6g20D9QAFM1oCL7oDZh+UvCF4g7l96t9JhreNrTT7
::/aIrZ+3Sq7/8ygt//dGDBw5MuiefPJiv9Z0NFkQUZKTse9FPBLA033rkpfJ5TQoXpUE0zX57mpaZ
::3uh1Np97Pl+5cOiuqccf+sm1wMOmVocVzAgg5e924uSI8n/0hzrJoRlFYjFju5oWihkrnLOuf+WJ
::N7LXDt05deS3h9cDHja7PK4K0gITSJBgATGuV+kt9cgnq7bb0tSjYgtx+60UM657/s9/y/77gy+e
::OHH+lfWCB3DJbGSjPQCxwRqyehmKZEqrwTaSjQys0uGNvtaj2ELsuHFGbe/No0v96SP3Hzv8w+8B
::fmJiwrbb6wMP4DRf6Yq7blQ1l80RUabKomE/bpLQpCO/pQyvXB7yapw3dtw5CpvNv0D/rX+3uxce
::mZz6z9SpUpXvM+32weF7YtdoLl8+d3Tspo/e3u/NF0Zi4r/RZkvrVm3U7ePW9o2JXYiLiiqiiPNi
::Ro0xzhi/ZHqzzxf53PE/ZNNHv3/i6Sf+DjAx8bBtixRsgmKXXfnTPcaOPdW64cOu6C3maBEm7cmz
::Bh+rqz9ryQB4X0+VCeCr8tLgs6S8oDGRMoq0ADFGnIggFMsmXz5Ld/Hls8XSmUO96X/+bOqfR48B
::MKmGg/exVoxfTxOAj33mrs/uufn2B0fecds71YyHAkLdU61A1iDSz01cvhEZKtxDCChvM+WPoTUD
::zfDZEkXvTfLO9Lz2pk/73utHipWzf3rzpUP/uHiRTgWc+xiW2W20uTBBeOQjH3/2xN73fvrL4q7/
::mIrsU00EoQLpVxHgh9i3xtuSa5oyFZRRfZEjsqKFL9D+nM/mT/v+ysWie+lY/tapU1NTL1+onyoc
::OHCve/KTeA7KloHH9j/Dnswy16CVsAAAAABJRU5ErkJggolQTkcNChoKAAAADUlIRFIAAACAAAAA
::gAgGAAAAwz5hywAAG+hJREFUeJztXWuMJUd1/k5V38fs7K7t9ZpHAhgMAWSMgsIjwYIM/pMfiZRE
::CmMJYbAgUcgDQhAkP5Io4wkiUR4KykMkBuFEWCDs8WJkwIBlG49tvI6fa693Fptdr3fX3sfM7NyZ
::O3fvq7vr5Ef1o6q67507M3cea/cnzW4/qqr79nfOqVOnq04TUhAzg4j4fe/7zO4Pfub6T43uefVv
::s1IfGL1kLwspCWAwYyAMWGyo7W3FvTEAZoZXKmFp9jROHqhDeLsADgBQ32tyzgVyL5lzML+9+IyA
::gFr2pDjgeeKesse3fPULb/oZAExMsJicJBXXie6QiRkgIv7c/z5y3aWve+MNcvdlb+4qoNnuIgzD
::5IrrusFh13XLrEMA1lyXNZGyVMbymRP4+QPPA5U3RCXT0nnt5z+PHKEYuG76H5FApVLB6EgJO7xu
::fddo6b93VVtf+o/PvrVuCoEAmCYYRET4wjcPfv2173zvze0dl715dqkd1upN5fsBmNOfs63+2Pnb
::6vsBQXUbUJ356J4oe48r/Kmcv9XWZQbCUOH8+aY6PbcUHp/r7j67XPnLuXp5+tP//MKbJidJTUxM
::CADwJhg0SaS+cPNTN+298qpPnDnXCZQKhRRCglITVmBACAmETcBnoLQX2sgOaF6GCCKAiIQAwBzy
::qTNzQWP37neFu4Mf/vmNs9dMfuqyMxMTEGKSSH3u6/uv2/P2d35idqHrg5WUQohNv+OXBSKiSUAF
::58Hd+ejY1imSviOicolKjUbdP9OovO3kqcWv6W7lBojrP/vliyuvuvzv611SUIEkKtR+vdAPXYDD
::Jrh7Th/Z4sfKDHiCSo2lWlBrjf7WR754ZHxykpTY/csf+GRpz2te3211OLIYBdaB1NgTYiFAdwG0
::xZYA0PcmJah+3ueFZfVnzExC7rrswyGIwWGh+UOD+SglOGyB/Rq2ujvQIKGCFjVa6lc+/sUX3i4C
::5l/zOwERUaH964bWenOPQACJ7SQEBFYcsDdyZqlztdix5zKwCvSNFhgCIrcLACAMrgWgWsB2EAKi
::UMgqmp3wDUJBErAVA5WXLyjS/ZRjSnwApbaBJWBAgdDyUSnM/pCRkk/JERADpANFgARUG/AXI/q3
::zhIQgwsB2AgYmg/StlVx4hEAkGDVAfuL2OruoBCAYcPVfOiQMDJeFoFVGxwswRaCzRWGQgCGDQLA
::WfLtsUG8SUDYBnxTCDbXGysEYOggQPTSfLKKJT6AMoRgkyOGhQAMHTH5gEk+k01+WgYABFh1Isdw
::c32CQgCGjHRMbWh+DvngNFDEFAWL2Af7dWymY1gIwJDBCa0RgRQNC5ks8oE4OmAKhxYCBJsnBIUA
::DBlmHDAhH0j8ggz55pAR0EKgApC/DOKNF4JCAIaMjObrg/q4Qz5b8YJoS+l9Zh8Il7HRjmEhABsB
::h3wAYBXbhlTzk1FA6immuyTAHIDC5Q11DAsBGDqy5GslJsPhiw/b5Bs1k7ZYBeCwAUBlzg4DhQAM
::HVny413L4QOllj3tC6IBhLEf+QSszkMLwXBRCMBGoJe3n9PnW5pPcMiPzwhAKUA1h36rhQAMG3nk
::ExmBIKMLYNekEyie3p4MH+NWCFAhwMMVgkIANgI543xioy8Asn1+JCAcWwEmq/tIrIMKhioEhQAM
::G47mJ9quJ+rHO7nkJ9uGZSCr64jPh3p20RBeHBUCsAFIyLeOROjh8CVmn5PBYQ75+h+GAKtQv0Ra
::pxAUAjBk5A3mEhu+Cs1HnuaDtN8QDSsxBCEoBGDI0A5fvEeGhrtCQdHQ0NZ8XSuP/PTtIcVOIRHA
::CqTaa44QFAKwkbAcvkgEiCyzjxXNvkm+sIKGMZgVwJ013WIhABuCPg6fVSxr9nlF8iMBScyBvhar
::EKS6q7YEhQBsBHIjfLbm93T44u68h+bnWQdEZcAhwN1VRYwLARg28jTfHALG+ys6fKsjP74Ocwiw
::P/DtFgKwEeDsOitiHsjhowHJJyKbfKSrkqEUAH8gQ1AIwLBhkm86fPH2Ghy+bCwA4GjeQJ5TCIIW
::ggEsQSEAQ0Zq9t0Tgzl8+n1fP/LJmk8IwBl2Gu0zg1R/ISgEYEOQ+v2p2TfPrFXz03bQj3xr5MEg
::BOgVLCoEYNigHHJX4fAJo5hdxiafqTf59rUIYAZx/lyCQgA2ELbDRxnNH8zhixszDliBhSz55Bxn
::iOhUmLnHQgCGiR7h3Vy/YIAInz4oMmZfF4z288i3rJBwhCiE2R0UAjBEqJChGAAJh0mX2MjhW1Hz
::RUp0fDIxKH00Pz6caD5Sx5EBokIAhoeYF4pezin7VKL5g0b4kgnAqeaTS75lCQbVfPv6FEmEN+jv
::LDAozAEaVnT42C0jALBLPtt9SNrPGFVtzXfJJ/MfQyAKCzAskAKoCnAJFM/eXYPDR47mRzxbZXIa
::txw+k3zLX4zppqgOFwIwPDDQPX8eFBvVNTp8nMgOGdYhotGomHYvJsVkkW/BTAJHlLxMLARgCCAQ
::WCm0aucAQc7JyOEDMIjDp5U5ihL2IN+9OoBoqVliBpyRYj750VULDAudZmgv4zM1nwfx9g3NNxF7
::7S75DrG6jFs3h/xCAIYMApRSUMGIlSIIoGyKmEHINyUlcdzIrhcRa4WanZnnPTXfaKoQgPVCMYQs
::obUwj06jAZIyOkHWHD7HG8t3+Cye+5l9Xc9dRmb3Gr3NfmEBhggd92F0W0DQBUhEnnsyPqekXILY
::4csx+5Qb4TNUN9Z8w5N3YwzuCKHf11AKAVg3COAQy7PzgKhAq6aIzrgBHCTkWylijDLsRPhsZ87U
::drJMfiYvQSQgK30KpxCAdYKIoMIQ52u+3l7B7K/U5yebPeYTJg1Z/T1ZbaT+x8r3XwjAOsDMEJ5E
::c6GGVj0ASS/S7JyhmoikYUWHD47mEzJjffSeBJIuIBnsNxQCsE6QYNRn6wh8D0Sco/l6n4zQbTbC
::l5KYt4DE2Em3YkHLkI+ByQcKAVgXiASU30Ht1BKE9IwRm+m0JaUR02/7eT003/Lk3b4EsF/8rI18
::oBCANSM2//XZBbQWGdKTqafvjrfTsJ65uUKKmHScn00S5Y4n10Z+epUCawCBEGLh+AJYVUBkvgc2
::nDZOcwayWz9nnK8J3xzygUIA1gQGQ0qJ5uIilk63IUvCfuWOLPnRCSTmfEWzD2OcnxPCGwL5QCEA
::awMDJBnzR2cRdD3NmRGMYcDWfIqV3I4LZFPECDtFTE9ih0O+vmKBVUH3/R6aizUsnGhAlkvpR6Dd
::QA0MuWCTfOqp+VaELz5leQfDIx8oBGBNEKRw5vBL8LvlaH6d2efn+X7O613zdS0BeRM1TNgJpoZH
::vnHlAoNAfyW8hPrps6id7MAreVr7E8bj/81XukZcgG1y2SBfh/RdzYdhVWwhGw5EMSdwcDCIBDhs
::49Shs2BUdQJoi1SKrXvswjvmwB77WwGhTFYwg3jjv+GRr8B+rfhY5KBgBmRZ4szPTmD5HGvP35pc
::kTNcy/X0ySpqOodkbeW0OSzyCcRhAAV/sRCAAZCa/tM4fXgJslyJHD+CSZul7b00P4GAyiz5iso4
::oz3dztB+DohBYIbwLq4XArASmCGkB7/dwIknTgEY0Y4fx568Qz4o9axWXKqFjNl33w+wUWZoICbm
::ANyZCwsB6AuOhmc+jj/6HFrLHkSJjJm7cZl4j1KenQUbKbE95uwbwaMM+W7vsm4IYhWAZGW2EIA+
::YBBkiXDyyWdRO02Q1VKU918g+0YPKYcqa/Z1gCdnqVZcxuz2N8DsG7+Ko5tkv3lcFQLQA8yAVyKc
::PnQE88d8lCoVQClQZnZvqrG6IqV+nrlgg3ot2DD7fEOweszhGwqEAKugK1TzeCEAGbAmvyxw+pmj
::eOmZBsirRrn40sfFPchPYTt8RvPGpjG238g+3wQDgjxw2Fr08dKRQgBMsDbvmvwjeHGmAVGuAtDk
::x5zbPOfN2e/t8JkWPi/Iw8MK8fWA7okkoII5HJrqFoGgCMwMEhJChDj5+LOYPdqFLFcBNsiHqZyU
::dgHWq8A0Wmet03PhTtu2G99AMIgkoNrzMzMzhQAAACuG9DyEQRvP738OtVMKslKNHL406YO1YZl9
::53WtS7411APiLkEHADeTfICEDIlYqKD1GPAKXx7OrMO7pWoJ9bNncOKJ02guErxKxfrKV7SBZKMX
::+abDl1zElYOt0vzoHhiCQx8cLBwFXqkCwByFdj1w2MGZmRfw0qEaFFfgVUSG/H6rdbQIuJ581pkz
::Z/roioPP3B0emImECLtLUMG5V6AARNk6SXqQAmjMz+HUwRdRn2WI8ggkIbM8O0O+cTBvGKevA+M8
::UrNvThrhTVX86L4YJMsUto4tLi9871HgFSIAHD1t4Ul4HqFVX8LZ507h3LEmlCrDq0ooxUYAp/e0
::bZd8vatHDzCLWOxmyY/b2EwhYBALIYnJf/b49HQdoJexAMTaTgTplUBCoV1fwrljZzF/fBndlgdZ
::GoH02HixM0ifbzpzRpm8PdPhI91VsNstbCZIKIISYXv2XgBqbOxe7+UjABHh8ePXpDNU6GN57ixq
::Jxew+GITfkdCeDvglRkMBY7z8XCk+S6xuZpvb2XGegmzTp8//O8+rgIMghCqswDVOPGUPnYfvDjw
::kC+N2aO55XIO5pUbfl1KtJG8EjwBMIdRto45LM8uo3ZqCc2aQhh68EpVeBXdJeiZPOkYPnc5V57D
::Z6i/duwoe3OG5iMqs/kOnwNmJq8susvPLokX770LAKanbwg9WSrr8/m1BjiSf3AjBCCdc6kAsPbW
::GRHhZ9FtMRrzizg/30ZrOYDfERCyBCElSpGpT5wvK5EjObO1BtT8zJz9GFnyt1oAmISSRJL8xf0H
::Dz64pH8Ysbd89mTi9ERFrS1zDEvJw4tLRG4Mm9+37m1R7M8fx4NmM4jCOfUIDNbZz8P4x1ThN9to
::1ebRbXYR+CPoNlvodkIAIwARhByBV0lqG5eJAjuut2/eV88+n6IgD/I1H0AvzY9S9m4hJHN4Hqr+
::3J0A1NjYDd70NALv+f87DfhLkWaQJeDaK9aRDGJKNSV5IhHZlgBEdeOgeRz8jlQv9bANAUgebmSI
::DbLi3RCRADCBUAIgwUQgKgHwQV4VXoXArMBM+kudDLghegCwsrhZURqbfFu/RVpwFZqfPI+tJJ8V
::C6/q+YuHm3Lp2B0AMD2tn4InSq8Bi1FwtwayJgmTnvSIqH+MiUQ8C8bUdDMHTlTQHhnBeriU7XFj
::YUkCK049AQJkfHUFECcPlaOUi6xYk5/x5I222LRsObN3o3ux5SI/GZNVZrv1+QaYhBICUrVPP/TU
::/m8d1w9Jr2UTjACQoxDli6H1TPevgAKRih62fuCJuxyViz6CosvALBPVgdK2llVSRq+cVfYfR9cz
::6yXl03aIdT/A4KRfTYQgmkmTI1oapsMXCXK/XPtAlvy8uP12J19LqgfunoNqHr0VAMavnUpuONpQ
::YLkTVLrEqRurfaK6jtSb2maUswslZdzPqcZmP6litGHnveuVehXRA0/LmU2n5dz+ujf5FtxMXNZv
::iq+Ts5ZvO4GZhfRksPizufD4g/sAYGpqPBmQGuKtAEsICNYqV+0IaNMLgp30cLXk28iecUnpVTcl
::v2epVZKfnspZocvudewI37YjHwCTp0i1ETSO7puZeXhhfPxWCaTpwp30dQqQo6DSRbBVjpI6KjG1
::zvm0EZt8cj+kbBaEI0Sx5id3bxt1oxl2yAdIT9hZQfNT9yVr9vtqtUk0UVqG8q6zTcAKJEuiu3go
::CGuHbgSAK68ct+40+aXp0dgS7E5LxQqQS76zaZDPlpOVrZM+cNPKxO04Om3JUHqOzHrmiNIY52fa
::7mf2Yff5pskfzMJsHzDJUCCgcPnnP555aOrAxMSEmJw0Exn0XBuoALETVL4IsfhnMl6uRL6zAiZl
::263taL7ucGEJmkM+55GfnI6osvL02eSTcb+9ND+7PNvtDrGtyQcYJEoU1A+Dl57+N4AwM/OOjAz3
::mROoADEKKu22FIuTLeMgkNF8q4CV5SqffIugmPyM2uW1be6mfXXcUm/Nd34HHIfPIDZNxkS6nJmJ
::a7sKAIlQUCi6tafv/737v30PJv5WTE1dm/loUP9JoRxZAu+iTF+tt+Ny8a6r+YZpziyRyiF/JYfP
::qt2PfPODiob4Jl2ZUcbQfDfCl38ds40+t7ulUACVKVh6hrn21MQkoDAzk3unA8wKVqDIEoAI5P7w
::vpoPq7B7B9kkSfmar8ffrgCZl7I1OcnGZTZmmX3Tj8kfxmXJT2ts6Jz9dYMB8kLitvDPPfLDQz/d
::d9/ExITA1FT2k2EYOD9A1B14u2zL6ZKfa2qdpIer1Xyya/ckn7WHYjWZQ761b1kzm/xUgIw621Lb
::HTAzUYW68/u7/uJTf7PSTa9iXYACxAhEaVd0obS37kd+PrLk5/b5cZCHjf4c9vn4XjIzcpIybBx0
::CI+FkdzRSv7v2Q5v9fqCGRAVheCsCBcfu/Hw/h89ifEPy8nJyZ4zEVa5MITBYgQkdxn89SdfE0tI
::x/mwxvlmf23BjPD1OJ80mPsZFlfz3brGSynDmctm34ya2M7Ep1BEkO1Td58sLxz+O4AJV17Z987X
::MCNIAbIKAqCChn3KMfu5MMK7Fvl5mo8eHPYjPyfIk7m+lbDJ3LyAyWcFeKMcLOxH2Dj4F08/Pj2P
::8WslJvP7/hirXhoW6zHLKkRpl/G8TGLNCqbmRw+/D/mcQ74rHEmDxhTsNCfDypqf3iYZZVzyo3IX
::BPkMyEpI/qxsn71v36H7brllfHxc9nL8TKxaANjYYlEBvJ0W+ckjJiAzZDSCMz3JXSX5Vhm2ybd6
::/cz7CjLK5JO//Tz8HiChiEPZPvWDk15r7k8ApqkVTH+MdU4KZUBU9Nv4oJl1pGDEW/L68xXM/qCa
::HxfmOGFjXvzfbiyr+cmNppp/QfDPiuGNsn/mTg7qBz89s//22UFMf4whrA5mMFVAclQ35jh8tuYb
::2hbzEVmKjMO3SvJBSKcjxNWtzBxpWSuU4Wo+XSBmHwA4BLydIdcPyO78Q1+auf/2OwY1/TGGtDyc
::waIMeKO29mY0nzKKCLivdN0yK5h901lLvQDkXMg6EwtI2sYF1OcD2umToyF1Tnqtl+64S132li+O
::j4/LqalbVzX5fIjrAhhMZZBkQLWScKv5L+cQ677STc0xepK/0kweNzKYc6s2+VE7WztvfxVgBVBF
::wT8nWydum6kEcx99fOp/ujN6qteqRHjICSJ0dwAxkvTF2RcyyGibRb5TZlDy9RGG2YiVlsWEOzPJ
::FLptDwaopIibonPylllqPH/t49Pfn8f4uFwt+cCGpIplgCogb0d6qCf5Yojk28e5509zrEPkD14Y
::pp8BCCYKqfPid/ygcexjT/30e4dW2++b2KAUMQxQGcIbcZRtEPLTJvo5fLqMQb4180ikWu2OCBKI
::1OG7YMiXCgR0Tt6qgvax6w49sO+usbExb2qN5AMbujo49gkIpFqIEyH3/3y6qfnOcLBHhM/6l/Xc
::YrPN1Lr3IP+CgALIY7CizolvUefcw584vP/uW8fGxrzp6elgPS1vcJIoBlMJENVoj9D/C9qwY/JY
::pdknWEJkd/+U/l1I5LMCRFUhbFP7+DeCzuITHzu8/+6bx8Ym1k0+sCn5ASIhIAJUxxl7R4gPrpL8
::zFvI9JLpJgFmerckLcuFgHic35mV7ePfagZ+7frDD955myZ/ct3kA5uZIEJEn1VTXfu4Q34SqHHJ
::z5tVlCi7WcaViQE+sb7tEPWV3u4AzaNe98S3XwratY/PPDB1L8bGhkY+sNkfjCAPkGVnvG6Tb/43
::mLfvOJEWnHn7usI2BwMQgBwNeekRr3PspifBdM3MA1P3YnxcYghm38QWJIqMhCBDyIDk95x/YFQn
::IHfe/nYnn5We0AGo8PTtsvXCLd+Vr37Xbxy4+8afYx1DvX7YkgwhDA8kCBT6YDN4M4jmJ22YC0hc
::OTDIByWrgbcvooXz3q4QreOyc/I2UPPk5w8+8L1/Bd+GjSIf2MIkUQwJEqR9AsuE93D43PAu6VYs
::hw+wNX/bkx/19aKqwArh/D3SP/uTZ3yFzx+6/zt3ARBRMsMNIR+wktdvPpgkIEqm3TZPAsjT/F4f
::WwCsJV3Ybqt0HbACIBjezhDtE6Lzwo2i/dL3v8qvu+aDh37yjbuAcQm9RHtDf4UH1Y7G6VvxtBiA
::jLZ9JBNCnFe6cVE3/aotuvmp2IxI0PYAKy2opV0B+TUvOHu37Mz+9IAA/vrg9O13Ynrfhpp8F17Y
::XWp6O0Z3cOhj66yBRDSrJDnian7elzbSwr1TsW0b8jXxDG+nQnheqnPTXvv0fXUV1L+85x0T/zL9
::lasa0FLMmNo4k+9CqE79FJHElsfGWAIopS6A4e33/9LGdjb7HJl6YpR2BeCQ1NIjsnX0v1Tr5B3f
::LJcveu/B6akbpr9yVWN8PDL52FiT78ILGjP3VPf80ltAngIruXKVjYSA7hJC+5gR5LHgLOzYNuSz
::igS4rCDLCn7N46XHvNaZ6RD+uVtl9VX/fmB638OAis29Ws8LnfXA68w+flNp9PLf9/a8X3CwDNAW
::ywAkIAhgZUwpQ84Loiz5WycAxsXJY3g7FJRP3D0j1NLToj3/WBP+4m3kvfo/D9z33UejoYkAJoCp
::yS0hPgYBwK9/+PM377rio9cFYm8Add5LHLOcB5qXyC3vwedxkUtQz7oMnRvIKWeEdxmc0fzMNdZx
::b71/qyltpEkXVQWEQLcmuXUE3YUnETSOPx+GrZtx6du+cfA7//R8QvzEBNBntc5mgjAxIX71iWcv
::q1Yuf2LkjR/5BZT2Bhw0vGyCBY3NE4BoK56nlTxvewnYiqnY1i0AtmlhCAZJQJQVIBiq7XG3Bm4d
::Q7h8BP7ykRpz+8eCyreWr/qjHz385atbUdVtRXwMAiYEMKmu/t0/fX+5tOsH1V/8zUswckXAqiuh
::/EzHurkCAFCURSxdeUzJ6wN2Cq9PAOKIZOKFMsdOpigpkGSwAoctD2ED3DoF7pyGv/gcws7cOQ6X
::7yY5+mO+5PXfPzD1j3NxBGpsbMyb/tCH1HYjPgYBgJ5NOhW+93f+4F1V8Neql777PeLi9wDeXr3i
::hInTHI6bKwD6Ju2M3vH7/Iy1X1v7rAVMAlCkhT4kcEDMPhAsg7uzQFCH6syjW38BqrOwCARPolN/
::UOx47QOV6lsffuiOv1o2nFcxPj5OU1NTKnu57YXUxkfBh7EJ9sLHr/8Myeofi/LeN5d2XyGEtwOs
::9I/L+6rVwCZ1QEnpK2RGYMctlzert7e2A0QCIAEiD8pfhgo74PA8lN9A2J5vIWi1FaMBDp9Fd+5R
::lPbMoXzpw8u099CRu/6h7rzaFmNjE2J6+oZws4dy64HVyeskQtpUjV3/k2qw9N1ruHPmavIXR0V1
::72uZdQbWLLJPXuWRMeA30dSAdpudi6g8CciJbTEzE4Rkf2kh7NYW5cjriMO2Au1sivLOJkvvLFHl
::aXnu6PHG5Z9UM/s+1oDqZNp597v/sHTFFTV1IWh6L/w/EM2b1sX+CmQAAAAASUVORK5CYIKJUE5H
::DQoaCgAAAA1JSERSAAABAAAAAQAIBgAAAFxyqGYAAC9RSURBVHic7Z17lORWfee/P0mlqn5Nz8tv
::G4Mf4GBMbPMIkGzAJzy8zsIuZIckZEnCkjgvyJ6EvEh2GU/gBLDD5pCEZO2QzQk5OA4DBmwwLDjB
::E0OMX7HxY+zxeGY8j57p6e7pd1VXlaT72z9UVS2pJJWqWlWl6vp9zrGnpXv1u7eq9P3eq3uvJEJn
::0A2/9+XXT4zjLya3b714684dW3ecd4FmFsYoLDN3WMiGYiXMmGbd2oqXIGPf6pYkVorBgqFYKeQK
::Izj25KNYPmnAMHaAYXfht0+WMc3PmjRedBYusuJnFfFTSpnfydvq//39npdMd1qXUMFG5f3gp+8x
::55at75/74gt/6OIrXpFnpRohyk7Mp8ryyZ5lo+hD3bLwvbFSyI2M4vgTD2JhKgdN3wnATr1MTlnZ
::ScNt9LcfyWuNEgkaWUrdB8bdJ+1jf75vz3V2slq4JDKAXbt2m9orr/naVa97zVvGJnewYtCaxSjb
::QMVhqBafqB8ne79O5EHvAaTe2nWQyTWAMUw9dj+mD6yAjYtBupFYsKkKEW0YRYrZWhWpa4SRvIbx
::EQ0Tozp0Aph41lHqD1/6R5f93z1EKkldWhjALv1dH9n1i5dfeeVnz73kMrYdpuUqo1RtVDNJGWIA
::HWYUA7gfp56ZA2MHtPw2MJmJIg6DAQRjbRnVcdakAdPQwFCPKwc/f/tHLn2y1fGRBnDjjTfmli68
::4euvuu66t2i5PJZ8wg8Wn6ySG88kBrARBtMAzoDVOMjIAbkdAOVaRh1GA6gzMarj3G0G6zpXFBsf
::uP2PLv47ILo3oIXt3LVrt1l88dsfesMNN7ylzDmcLoaJXxC6D4EAEOBUwNUzAFtob+hquFgpOTh8
::qkqLKypvaPTZ//bRo78NcKjOgRADuPHGG3PmNa9+8DVvfdvVs6sOlqrU8hpfELoPAaoKrs6LCbTA
::UYzpBZuOz6wpMnBLnAkEdu7Sly/8yXte+9a3XT236mCtrfFEQegiRO5/qiImkJCVNaWdmCkrMnDL
::z3zshV8My+MzgHd9ZNcvvuq6N715tmiL+IWMwK7wa38yCCwmkJiaCbBOzmdu/NjMecH0hgHs2rXb
::fOkrrvxsiU2sWfKlClnAI34fNROonAG4CjGBeFbWFM0uOvlVLH9jN/svBRob2lXXfn3rRZfyigz2
::CRmjLm//UJQGZqvWExATaMWZZYfWKvTDz37s4Pu8+zUA+OCn78lf+SOvfvNCieVbFDIHIyh+avzL
::ygJXF+RyIAEnz1QA1v/kjbu/Y9T3aQAwt2I9yCPbOW41ryD0g2jxr2+zzA4kwnaAhRX77PPxot+s
::79MA0DkXXXhF0ZJvTsg6UacoAcoC6j2B0HEDAQAWVhVs4rfXt7Ubfu/Lr9952ZV5mesXsk20qOuL
::hVhVAWvRNQNpz0JRirFaxpt+5sOHzgEAbXJC+8uVsqhfyCIU+DcshyeNNLCyAEvGBOKYX66yM0rX
::A4BmToy/SK79hWzCSC7+9b+ZbTGBGGwHVC7ZPwYA2sjWHZP9rpAghNO++OupzI6YQAxrVXUlAGhb
::z71I73dlBKEdWom/DrMN2GICYVRtvggANL0wKt+MMDAkFX998pCVmEAYDO1CANAqsuZfGBDaFX8d
::pWywtSgm4KG05gCIeB6AIGSNxOInv/i5PkXIlpiAl9pXIAYgZJ6Nib+eSwPYAVtLYgIexACETJOO
::+D352AKsZYBtiAmIAQiDQpNWo8WPKPEDcO8itAFrSUwAYgBC1mHUWn6vUGNafqbGEGCz+INThGIC
::YgBCtmmn289xLX+zyN0pwuE2ATEAIbsEG/4Uxb9+nA3Yi0M7MCgGIAweKYm/nsTsAPZwDgyKAQgD
::gKcrkLL43SDDezkgBiAMDl0Sf+PPITQBMQBhAKCui78RRzmuCQzJQ0XEAITs04744x4H1kr8jfgK
::sJdAqtxuTQcOMQBhAFhXa9fFX4vBYLC9CtrkswNiAMIA0Rvxr2dlsL28qU1ADEDIPHXp1V+ZHS/+
::YJrn7zbE39jPm9sExACEzMOgRte/l+Kvx2dg05qAGICQaRjoq/h99bBXQJtsdkAMQBgAuFlyPRR/
::LTOYN58JiAEImaf+4o/1Hb0Xvw97ddOYgBiAkGmyJP7GYCTYNYFNMCYgBiBkmHXJuZsJxd8UJT3x
::+5KcwTcBMQBhMIi6LTi4GXidcDfEX8/LjIE3ATEAIfv4ngjUn25/VF7XBIoDawJiAEKGqb8bMJvi
::bxzCDHaKAKrR5WQUMQBhAAh5e21GxF8vgwHAKQGwosvLIGIAwgAQnAnwJGVA/L6qqDUAg/O6LTEA
::IeMMhvjrcVgBUCUMigmIAQiDQ0Lxx98Z2AXxM/kXCykamJ6AGIAwGLTR8oeMGNQydkn8YXVRqJmA
::ExknC4gBCNknq93+KPE30pF5ExADELJNj1f4pSb+xiJGBriMrJqAGICQfQIrgt1dAyD+Okpl1gTE
::AITs08PlvaHFJxV/YMLCR0ZNQAxAyDaDJP44iBqXA5Sh2QExAGFgGGjx18MogJ3smIAYgDAQ+CYC
::BlX8tTjM2TEBMQAh85Dn/4Mufm9cdip9NwExACHj0LroBkX8RLHib8RhgFV/TUAMQBgMKPSewFpa
::UI19Fr83Zqs4DRPoz+yAGICQaQjsLrWPUl1Yy994gUiLvL7D+iD+RkYAfeoJiAEImcZd29+G+OtJ
::rfIGygiL4cbpsvgb+RlQVRCpmELSRwxAyDAxK2s2kfgbxwFuT6CHJiAGIAweAyJ+8g5gJozDzIBT
::AVHkiEeqiAEIg8UAiT8QtI04AOzemIAYgDA4DIH46/VxXz5S7boJiAEIg0FQRJtY/Otxum8CYgBC
::xuGaiMKFu3nF30hw1wl0aWBQDEDINoFVdcMl/loSA6y60xMQAxCyT+O8H0Lxeza6YQJiAEL2qQsh
::gyv8eiJ+370D6ZqAGICQfRgNRQyt+L0oCzHPPm4LMQAh23ieuT/04m90BDg1ExADEAaCdsQfNWjo
::xumj+GMeb9Zc1ZgyuCZ9ZW34ckAMQMg87bb8vL4RiNNn8UfVBe2J3xdSWSDufIpQDEDIPH5tDGC3
::vwvibyQxALZB6MwExACEwSHxizqzK/7ggRsSv7c8djoyATEAIfsQYgXX/KJO76FDIP5GvvZNQAxA
::yDaNlYDhqhuUbr/3wODLhFMRfz2VVVsmIAYgDCyDKP6QEc3ozXbF3yieE5uAGIAwkIj4w1Pr30tS
::ExADEAaOePFHbQTYxOJvbDO3XCcgBiAMFNkVf7Qw+yH+uhmxUrEmIAYgZBfyzHXTJhR/cGwzZfE3
::cimFqGXDYgBCZmGH3ffoBR8NvlnE76tMl8Tf2B/eExADEDIJEWCVFRyH22glWwT0hhkm8dfjMDeF
::EwMQsgkBijVXqOTZ6c8SsRGM1X3xx888ZED8jXx+ExADEAaDpjvpELERQMTfHMNjAmIAQvbh9dGy
::4LjZZhB/82fqovgDiAEI2YUJ4PVTNE5fTfRY/E3DAW2IP7K8QI7UxO9JM4LHCUI2cKB4HMwKgAKB
::3Cfh1BHxJ4wTLX5AegBCJiFoGgE0CiDXfJKK+BPGiRY/12KIAQiZg4hgra1C2RVowTsBRfwJ47QW
::PyAGIGQNZpCRQ/HMNKxSEaQb613/TSD+2PICw4HdFj8gBiBkDAZApMEql6Es2z15a0uBI4lpQQdL
::/N7Dui9+QAxAyBrMII1QWVmGXa2CiNpu+bnRYRDxN0JE3A8kBiBkDtIIdgVQDoPiztBN0+33HtY7
::8QNiAEIGIWJU1jQ4dkzrL+KPjJNU/ICsAxAyCGkE0iYAOMHZ/1oG7wneLFr274gpKKPij1v23CJO
::O+IHpAcgZAzSDFSLi7CrBCITCMq/hfgDO2IKyrD4I3PGx2lX/IAYgJAhmBl6LoelE4dRXj4DzTAC
::q/9E/JGpHYgfEAMQskRtBmBteQ1OxQY0WheFiD86tUPxA2IAQsbQdEKlRLCt+nnNIv4uiR+QQUAh
::SxDBscpQzqj7RFsosG8eMEb8ccKvxW7QpeW9/sHHFMQfs8ApmN6J+AHpAQhZQSlohonizHFUi1Vo
::Rt53vnsX+ADZE39keU2p2RE/IAYgZAQGoBsGlk9Po7y6DDJ0cO3Mju32i/g3hBiAkBk0AygXTThV
::DRoBAIn4uyh+QMYAhIxApMEur8C2RwBiAGoAxc8RqdGV7af4AekBCFmAGVrOxMLR51FeWoJmmFCB
::19q19b6/rLb8cSlx4g98prTED4gBCBmAWcEwdSzPrmFtpQLS/Kdlpy/73DTi91YlRfEDcgkgZAAi
::HXZlBVZ1tNbtX2/+B0v8HNiOqGpkjGBduit+QHoAQr+pdf/njx7E2uIqdGMEXDOAjsUfs16g3y1/
::dIxgXbovfkAMQOgzrBSMgo7VuQrKK2WQTu7iv420/BHrBUT8zcglgNBHGKQbKC/OoVI0ayvkHJC3
::Xeqw2x9cItyLFX6DJn5AegBCH3Fb/wLmDh9A8cwSjNwoKPZGeA89En90mcEyEoo/zjR6LH5ADEDo
::KxqgKigt5WFVc9BIrQtQxN8TxACE/qAUdLOApannsbbkgPRJgGuj/yL+niEGIPQFd+0/YWFqFeWl
::EnS99uiPQRV/rGizKX5ADEDoB8wgPYfVuaNYW9TA2AIiJzXxBybaIeKPRgxA6DmsFMxREwvHZlGc
::X4Wey7XQUHstP3tS/XGCFRlu8QNiAEKvqbX+pfmTWJ1jKDUG0pzo/B13+0X8SRADEHqKUg7MsTzm
::Dk1hda4II19o3PffRMx8edbETzFbWRU/IAYg9BJm6EYea/OnsDoHKDUGIKL1D3tJRsQrv0T8nSMG
::IPQMpRSMvImZg0exemY1uvWPfUNOh+JnEvGHIAYg9AZmGPkRLE8fwtJpG4rdN/800S3xR+dMR/wZ
::Wt7bDmIAQk9gZmjk4Mzh01hbdKCbZnPrHyP+ZmFGp2VZ/PEDh71HDEDoOqwUjJExLB5/HsszNqBt
::ASnbn0nE3xfEAITuQxqctXnMHVlAeVWDZmgxd9hBxN9DxACErsKOjfz4CM68MIXlGQXdnARQa/2b
::nt8Hj1AIwRV865puTmtshgz2rR9GgTL9cZhoXfwhb+htihOWGvuZsoRiQAxA6CLMCnp+FKunj2Hu
::hWVYdh5EtivQNlr95qW9EZtxrX6LpwYNU6sPAKo8TYAYgNBVNECVcPrZEyguKOTq036bUvyBpAyL
::HwCUXSwBYgBCl1COA6OQx9zho1ic1qAZk4CyQsQffS0u4u8e+uiFBwAxAKELsHKQGxnH6vQRTB+Y
::hVXRoWk2OHi69VH8vut9YKjEDwCaPjEPiAEIKcOsQHoe1dIspp85gUrRhGHm3cUvkcLtvfj9lY4r
::fvOJHwDYXs4DYgBC6hA0XWH24FEszeWgGRNgDnT927qXP2IzY+LP0uq+JDjFQ9sAMQAhNQjsODDy
::ecwfPYK5w2uAKrij/uQ5zUT8mYCMbQcBMQAhJZRjITc2jtXTx3DyyeOoVvLQcoEFPyL+zGCMXfoE
::IAYgpIA76DeB0vxJHH/8eVTWxmt3+ik0FJOG+CHiT4vKwvfOAeTFIMIGYVbQjBFUVk7jxGPPorg4
::Ds0cA7ONJOJv73beiJwdij941LCIHwCIHQVID0DYCKxAWg6ENZw+8DyWZkzouXHAK36kJP6onCL+
::DmBA058GpAcgdAorQMuBuIzTBw5h/jhB00eA+lJfAMB6qz244ief4gdf/ADIgFOc0gDpAQidwArQ
::TBCXMXvwEE4dKMKxCyBdWxcI90/88Q8VCR6WPM6mED8ArswyaeZ9gBiA0C4N8a9h9rnDOPlsEUqN
::urf41hWS1jV/FK1W+PkKjCxtKMUPAHBK9ORXP/QkIAYgtENN/OA1zB48hJPPrmZO/P4CI0sLxCEM
::jfgBKMc6hl27dEAMQEgIKwVQDuA1zB08jJPPFOHwZhF/dBmbTfwAAKc0j717HUAMQGgJgZUDPVcA
::aVXMHTyEU8+sQvEo9FxGxR9dmogfgLJXT9b/llkAIQaCUhZy5jjKq6cxd/AQzhzT4KgRaKYGVq3F
::3+kKP3++Nlt+DuYKizOc4gcIbM1N17fEAIRIlGMhNzIBq3gaJ584gIUpHaTXlvgmFP+6kKTbnwnY
::AVdXluubYgBCCAxlK+S3TGB1egonHn8GxcUt0IwCoDmuQpqm6DbS7W//1WDdEP+mFn4NVZ6GoZ9z
::e31bDEDw4a7fN5AfN7F47CiO//shrK2MQs8XANQW+aQq/gg2IP7oJw4Pt/gBwKlMO0987Tcerm+L
::AQgN3Nt5x2BX5jG9/ySmDyyjUhpFbmQUrGrLezMu/ug4In4AgKpOw+OTYgACwAylGIWJcazMnsCp
::p45gedqAowrIjRiR4g+KSsSfdQjsrD7p3SMGMOSwY0PLjcA0HZw59DxO7p9CcdGAnhuDnrPd+f8I
::8UdrOrn4fV322Ad4ivg3DDvg6uJpeL49MYAhhVkBTDAnJlCam8LsweNYnHJQLhVgFEbAbIG5tkwk
::pNtfF25zY96e+Nc3UhR/5MzDEIsfgKqcAgHf9e4TAxg2mMFKQc+PAWoVcweexOzhBayeIZA+DqNA
::bpefosXfCJVE/ByeuWvij6zLcIsfAFRpSmFL7kvefWIAQwQ7DsgwkSvksHL6EOYOzWFp2oZVNqDn
::JwCughWti2Wj4o/I3Cx+jkgV8aeJKs9MPbn3wwvefWIAQwArByAd+YlxrC2cwvRTU1iatlBacqAZ
::kzDyNpirbqsf0bf3XfETAjP3MeJHSi1/XIqIvzWkQ6nVI3CX/6v6bjGATYvb1SfSYY6No1pcwPTT
::z2D+RAnFMwqKx6GbutvqM8F3W0haLX/AKUT8/YOr80zG6IPwiB8QA9h81K7xSTNgjo3CKi1g+qmn
::sTTjYPVMGXYlBz2/BQZsMDsAyC+iTsUfTEvrmj8uRcSfFHZWD5CF/F8FE8QANgnuqD5Aeg75cRPl
::5VmcfOJxrM5pWD1TcV/PZW6vdfctcF0wQRH5WuxeiD8yZzwi/jYgUuWZ2QN3/d4LwRQxgAGGmd2H
::dJAOwxwB6YTi3DFM759FcZ5QnC/DqeSh5bchV3CgVL27HyK0mmjrQwADLf76fUoifhd2gOrSMbzx
::jQb27bO9SWIAA4YreleimmHCyBtQ1VWcOfwDLM9UUCkaKM0X4TgjMMydMEYcMEcIP2S039VMeuKP
::XuQTEbMV0vK3Cztrx0Dgb2DfPieYKAaQdZjXH7oBgpYzYeQMsFPByvTzWJxewNpqHuWFNZRXLZC+
::BbqxHTnDASOmxY+Y6vO2/b1o+dm3cKcFbdzSK6zjrBxAfmLrZxDyTYsBZIz1Fr7WFddzMHI5aDqB
::7TKWpw9h+dQcKqUxlFctrC2X4DiAYUwgVwAYDsB2U0veIPaV2NR4Cnan4o8fqAse1o5ok7f80vrX
::YQAGqfLMiYe/8fHpsBxiAP2g3qqzbxdI06AbeZCuQdMIDAdri6cxf+g4yiuMamUMldUSyitlOBaB
::jFFo+k7kDHbXea93FELLbCZEVBzWIG9A/BFi7Jb4BT9sLzKR/hh27dLrzwH0Yrg3ewQOSh4+vVwJ
::C01at8SfoYflMgNEGjQjB400kKaBiEDEII1gl1ewMn0Ea8vLqKw6sK0xVMuEyvIarIp7x55m5EH6
::Thg6g6FAwUU7sZfa4dN9vgG/phiD0/ILQYid+YepkB/9qzDxA4CRK4w2nbSJL8mS5CRAJckWeoto
::84GJhZj0JPNVLu6kTVhuLUxz8QpEDMeqYm3+JCqry6iW1mCVq3CqgONMwLFNVFYXYFeqsKsKjq1q
::rfxWaCagQ9W6uE7TSH1s9alWodrgYdRUHwiBB/T0QPyxP6iIv3Pc7r+1emjhtS8u/vPDEbmMU09+
::D4DuOcj7m8R/s5xUFQmyccsuarBureL5j2u7QpHx4lHMcCyGqpKnGILDBQBbwE4VdrkEq1KBY1lQ
::toJyAKWWQZQH6QWQNgrNALQcg+F278GASvzwzdBPEPvlNX9dIv7BhsD2ImswfnDbbbfZUbmMmSMa
::2Fpwu5O1Lzr2WtJbQNSj3DzXk41WxZO6jsdqGOuLU4JFMxo/elORHF7Pet3Cn1hDzRkBxA2Q+e9X
::Cf9iGO46S1auZtcLJCg4ILbcxljTwSiA9FGQBmg6oNeObgie/AbLnYo/crR/Pc5GRvtDy/IdWDNu
::EX8PYQBgZ/4hypuTN8flNFg/B8AEuLrgDk6h3lOMm56pGwX79jR1S2sxVFirsl5READlMRRfL9QT
::xy2T0HSCsv9vYldKbl08Jwz5TaYWsHZQzanq8Zg8nylQRqjjAIrc40kHyIBPLDoYBPfhGoz61J7T
::OLbp8/qquEHxe+sfiNOd0f6g6UaLv+m3FvGnA+XJLh6Zf+3Fq/c+EqNkA3BAegG6OQllLYC4JoZY
::i/a7ex3N+3N6hNJ82viPc/3KnYIKPx8jTorIa976rS1+8YfIx3WLsDJqm/VbZNYHxyJaf82N3vhk
::aj1voC1MLFoOjMhtSPx1c/QcGDra73M9DyHiX/f1ZKINFhrWJ0kSR8TfEnZKz4NYf+K2224LHfyr
::YwBwu536KDTAvRxo0fKHpwRa/sjjguLvrFWJ6Ew06uItJXZAMPZGmKi6BIpuOsnjPlN0Vbomfni/
::nigDpWBGT4zOxe8b2xHx9wDXvdXS05Q3x292v7Hok8V7DyhYHwWZ20GhJ/vgiN+XlHQJaobEH8yc
::RrefAnE6eYZfu91+368t4u8ZDMBeeX7l2vOn7nW7uNEE3g3IYH0ElNsWL0BfShrij+s2xp2c2HTi
::Z6auXPM3DqQY8RP8Z0SXrvmTxon/PEIErJaeYn1k551xo/91ml8OygzWRqA1TCDD4o+qCwZX/P7D
::UhR/06VABPUMIv4BhAHKwZ77nqabF+9Ggm8u4u3AQRMII6H4KcPij0vZTOKvJ0VVzuvzhHTE39Q7
::Sx5HxN8xrCrTgG4+89idv3Q0yQExrwf3mkAwm4jfsyOyLpkRf7BrH0zzkpb4I3PGxxHxdwoDpME6
::fS/0sYs/unv37hhtr9MiE4O1AjRzq+eH6YL4YweBfEECSQMqfm+r3IOWvzk9uldX/9lE/AOIY7Mq
::Tdl6Zfare/bsab7JJ4QELsFgKkAztwGaJ3tcX7fH4meiroqf0QfxE9IRf5Nvh6QBqK2SCtddGuKv
::348QEUfEvxEYALE1820YE5f++aNf21NKemSibkLDBHJbAY3aE3+cUFISfzwbb/mbF7NsTPzuassW
::4o8N41F13Pv6Yn8nz+5Atz/6e/Hna0v80aki/g1T6/4vPakof84n2zkyoQG4hTDlXROIcvKOxR+T
::1Gfxd6PlD2bsTPxI1vIHdwQV3oH43cNE/NmAAWhszz+ojNEXffvxve+fbefoNgygVpzPBET8CYrz
::JQbvRehc/PW/fTcpRMShcHGF7GuEbbXCLyKGiL/XMEAaW7Pf1XXtrN9MfouuS9sGAARNANkTf0x6
::UH5RNE9pZVH89QM7aPk9ab6kwBLksJY/dfELHeK2/tb8Qwxj9MnH7v7A86D4lX9BOjIAwDUByk02
::LRvuq/ibBpriSm+j5UfMZ+q2+IOfKfD9xseJEb/nMeDN5YUHTKXbH/g89ZsxhU5wW3975p/1kYmX
::/mrSqT8vG3smIOWB3CTIWqzd4toD8UedLC1alI7F36WWn5uzhYSIrktMceE7/HdHxZfX1AtIUfze
::mCL8DVBv/R9kMrcffPiLv/4Atdn6AxvoATSgPJDb6gvVl5bfS9zy3gyIP1GMlp8pQcvv/ZMQcikT
::ckzq4qfQNBH/RmEAOtuz9+nm1svfH34DX2s2bgAA4LkciF/hFzzO87eI35OWXPyJH+jRdHtxoLwO
::uv3+YqNMn0X8qcMA6WwvPqQ0bezhf/+nX78fHV5IpWMAQMMEfD/2sImfEoo/jpjBx2CcTp7mQ8Gk
::DUz1rXuGdPt7iwIcm+2ZfzZMbeLn0aJJiiM9AwBqJrCl5WBct8XfdJIPqvjhr0u4+BNMAzLFDh/4
::DqpfCaQi/kA1RPwpwADluTrzLUXG1n999FsffxYbGEZN1wAAvwm4OwLpnr+7JP7oAoOHpSt+d0A7
::BfEHCgx/sKk3Xwctv69MT1kc+AwR1/zcos4i/i7BDFWdU2rlKUPLjf8SOhj599KdNwNRHmQQ2F72
::n0CDLP4ksw/+h+p3Lv6YuoQ/zCPiDp5ET/Btr9vffHxIqoi/O7AC9DFVPfx/QMb22x7/+scO4usb
::C5l+D6AOmSBjy/rJMMjiT1Cflnf1JYjRqi6x3fik4qeQMj11aVpgGBa+DfELacEACPbKM8xscV5/
::ye52V/2F0T0DADwmENeqdEH8vVje23fxt+72+/eFZfZ8BqSwwi+sWGn9U0IBesGxp+7Qc6MX/MrD
::93xgut1Vf2F01wAAgExouS0ASMQfEaNVXTq55m8uL1hm4LtPueWXt/SmSW3g79Tdimn0hXz+in9M
::K3L3DQAAUw5abovvxN6c4k9Iwro0zwK2qGen4vfFiAgv1/x9wn1Ig6rOO7z0aG5k7GW/8P29715L
::K3pPDABwTYBM1wRE/K3r0rwgL6qe3BQnpNDQSwCfTmtr8qkpV0idRfw9RAGaqcpHbgUbO259+K7f
::+tc0o/fMAIB1E2hMm4n4E9alRVqS0X4Ki1Pb9oi2+REDIv7+UZ/z/xeHjFEUJi+7Ke0SemoAQM0E
::chNoftCoh0EVf8IYrerSXrc/aZnBMprFX8/VyCni7yNcm/Ofd9SZ+3L5yYtueHjvB6bTLqXnBgCs
::m0DogFk3xM+0+cTf6jbaKPFTC/E3rgHixO+zCRF/N2AF6AVVPnIbKL/ji4/u/YNvd6OYvhgAADAZ
::rgnE3TvQsfijNjoTvzuinTHxxxEm/vpQQYsLluA7CZsKb8RmT34hXRRgjHL15NdsIk23xi7+nRaD
::PB3TNwMAaiZgbHFNIKPiD8uYFfFTc85kLX9cHN+dgcEY/t9ExN8NGIAGe+WAo1YeM/MTF1//zJ2/
::exQt3vHXKX01ACBgAus7G3/2W/wD3/KHbcdN9SUQPyDi7xrsAEzKOna7DmP7Xz/6lf/1rW4W13cD
::ANg1AX3cNQERf/hm3AKdpjKTiT80T9iKwZC1AqL/LqBsUG4blw/falNucoa3vWZPt4vMgAEAAINR
::M4HaidcV8Yf2mcPLGBjxN10+JRd/u91+oDYeAiF12AFyo6ic+KpFvGzq5vjbnrrjPae7XWxGDMCF
::YYCMMWjBaqUl/jiSLu9NQfyJV/iFjPQ3iT86NbayPvFHHSPd/h7BAOmwlw/aan6fScZZv/z41z/5
::g16UnCkDANwxARijoHrVNpn4m+PEiD9YRFx5CcUf3wny9ARE/L2DFVjZqnrkbw0eedHnqq/9xOd6
::VXTmDADwmEDMYqFBFX/yRT5xlyDtiz9Uv5HThSL+nqEskDHOpec+oWjkrOfMHW/4g/17qNqr4jNp
::AIDXBEJO5qyKv+mpu51e86cr/vre6DiBbr/3I4n4u4eyoOV38Nqhz1RJMw29cOE7H/38T53qZRUy
::awCAOyYA3W8CqYg/MHCWWsuPfoo/vnPvzybi7zvKBpmTKJ/4ShWVqXxh8mVvefyuP9rf62pk2gAA
::vwk0Le/10KloM9Xt35D4W9DyTSTkyyfi7yLsAMYoKlNfr6rFB/IYv+JDj9z54Xv7UZXMGwDgMYHG
::DhF//Z/WL0n1HBIZh3x/ivi7iQI0E87KIcue+YYJGrn5/J/4yGf6VZvuPBS0C7jrBEZBdinwnNFs
::iT/6DVzpt/yt1vVHF+jZltH+HuIu83WKR+zKkVtzxuQr7pzc+baPf/N/UKVfNRqIHkCdhgk0GsBs
::iT8iqTloGuJP2vKHlR/zIcUAukXtGWnsOOXDt2kwtn6fJl73wX1/f91iP2s1MD2AOu69A6OAvbZ+
::Xduh+Du/OQi9ET9zaGpq4vcNhLYRUmiT+gMSlSrt/yjpYy+Z1yeueO9jd/yXk/2u2UD1AOq4KwZH
::3dpnSPxtPcMvrZY/Vrgi/v5TF7/Dpf0fhTZ20ZnCjpe/8bG9v/x8v2sGDKgBAABDr10ORCi3Dy0/
::RPyCj7r4bS4+8wmbCmevmJNXXPfQ59/f8+m+KAbWAADXBKCPNJvAIHf7I1JF/IOGWhf/s7dYRCqn
::53f++MN33Pg0Es3b9oaBNgDAawLh9w6kIv4+r/CLEj81lxayJ1z8QjdRAHQArErP3mIBtkmFbdc+
::dveeJ+D+IJmx3oEbBAzDvRwogFQZ7GnWUmv5fYf1Svwc/gLOxC1/q15RXByhcxRAOTjFI6p8+LMK
::umHqo+de84N7Pv04MiZ+YBP0AOowdEArNC4H0uv2ew/rXcvPoBZ1CSLi7zvsAGTAKb6gSgdugTZ+
::0QKddfUrsyp+YJP0AOowdJBWAOxyY98gir/xp29VUWRpEPFnAHYAfQRO8bBTeu5PdWP7K2e1bde+
::6fHPv3c/Mip+YJMZAOC5HLDLiBVmkNiudq+v+QNJkc/wq/0vap2/iL831G7sqZy8x65OfcHQJ152
::0Nx25dsf+fx7DyDD4gc20SWAFyYdZBT8AhhE8QeeCLSRlj+7p+CAo2yQMYLK8S9W7akvG/roS/dp
::237krY98/pcO1HJk+pvfdD2AOm5PwASrSvxPEPGo7FqiP2avxR9dWiBOjPgzffoNMgywAmk5lA/9
::TYWL+/P69mv+IT/xht998I7/3PVn+aXFpjUAoD4mkAeranj/N23xNy8F7LzbH12aiL/f1Ab7wDaK
::Bz5eNtRKQd/6qg9Zl99064OfomK/q9cOm/ISwItrAmb8YqEW4k+8wg8piT+u2y/i7y/KBvQxOKvP
::cfGJP6jqeq6Q23LFrvFrbvrzJwZM/MAm7wHUaZiAssCsuiP+bg/4NcUhf34Rf5dxu/wwRlE5+RXb
::mvqKoY1fbplnXXv9Q7f/xndw18f7XcGOGAoDAOomABBb64uFODhAmy3x+8ciI1p+CmyL+NOn3uVX
::FVSOfq7iLD6Wz+14/f36xNXve+j2nz3U7+pthKExAKBuAhrIqfpWDLrEzRikK/6QoYLOuv3BaUAR
::f/ooG9BH4Sw9yZVjt1cNzckb21//oZEf+uO/+bdbaKXf1dsoQ2UAgLtCkHQTZFfri22RpvjXp+Sj
::W343zaPWTq/5g5cBQnqwAgCQMYrK1F125cSdmjF+ed7Y9vI3v/inP3Tf3neT0+capgJd//vPNZ0+
::iReMJMzHCTImLTNx1VpkJGLAZwKIFT8zErX8br64bn+9F1C/DIku3v/Ir4gBP073u0seK1nGRPF6
::/Nu3jMcOoBeg1qa4fOTvLC4eMbXtr9lvTL7opx79x998NmE1BoKh6wHUYSaQYQJ2FQB3vdvvHha9
::OCe05U+wwk9W96VIvdXXR1A+eZeqTN2t8uPnm9p51//2WRf+1N9+8y9eutznGqbO0BoAULthSDcB
::Di4WChF/4zq7hfgj4rQt/si6hPRKxAQ2SG3JpV4Ar53g4pG/s1E8nMttf+2zbJyz65Kf/Z0Dm6XL
::H4Su//0DTc3fMFwC+AISe0wgfDyAEy7y4ZBWO0z89e8kTvzBh5dGtvxyCdB+mfV47ACkg5hRnrpT
::VabvVbmxsw1j/KpP5S595598/89eMZ+w2IHEcNcCDXkTwgRQHkDVM6/uTUfvuv1RqdLtT5navH5u
::C5y5B7gydafFlRnT3H7tM6M7X/XLlZH3PPL9PyOr37XsNoZTPAR97JJ+16P/MAFkAgh7L6OIf/NQ
::6+6TCVhnsHb4Vts685Bubv1h09h69fv57Cvv+Lfb3lECfq7fFe0JBpS9BmCk3xXJBHUTYAsNtXap
::5U+0yCeQJuLfCHXhG4BTRGXqS6oyc5/S8xNG/uyf+NbY5KW/dv/n//sRIhqqb9lQ1eWjOnBFvyuS
::GZgAyrkmEHdHnrT8A0L9nmodYAvV0/dy5dQ9DqkVIzf56lMjO175HjPHD+37+/eV6fb397uyPcdw
::qvOLuX7XImt4TaBG8hV+KYq/3gkR8XeAZzCHdNgL/86Vk3cpLk/pxsRVKjd+8fvUziu+8MBt7yj1
::tZp9xqgUZw7nq0uvI3Oy33XJFkyAFtITaLXCL2J0vpOWX4TfCd6ufhn20hNcmf6mUsXDuj5+mZ4/
::/x23GOolf/rAl941iyHr7odh5CYv/Utr7v73mOf/p37XJXsEewKpdvvDphsg4u8Yj/BVFdWZe7l6
::6huKq3O6PnGZbl6469bC5Ll/nLvovJl9e66zY58QNUQQsFt747ut+cLFPztJWh7AEK4DaAWxe1OI
::f+d6iOC1eoKW3/1O4q/50/8dEuQZuHUAtb2UA1tLsM48wJXpbylVOa0bW14GY/yqT5nj595sXvre
::+X17KPgjDj0EAK9/5/+8Y3TygnfnzvkJAsQAQvGZQETLHxBt7CKfuLR2r/2HzgA8X5AxCmflAKyZ
::fcpefBxsLWraxGUwJq761MjWV3zyvNX/OL937+ZcxZcGBAAvf/kuc8dLt5ZHX/IrROZE8wq0KIbI
::ABi1G4jY8cwQhqzwqzdIwQCBa37/TUjho/1iABFlkgHYa3CKB7k6/W22Vw5AM0Y0Grl4UZ985f/e
::Wrj8r7aX37wowm9N48z7D++5+Qu6dfq/Fi75NeLaTREtGTIDAOomoJoP8zRKSQb81k/m6Kk+MQBP
::IgMwRmAvPwNr/mG2Fx5hVT1DRuEcwsglzxs7fvi3F7e97ls/t/1ya88eSngCC42z7+W7dpvbq9Mr
::+W1X54yz30Lu+81aMIQGALgm4DPJiJH/Wmbvhicbt5znH14D8E7h5cDWAuzFx7k6+y9wSieZSNe0
::sRdB3/Lyuyi/47dK1rET+/feZLnXaUI7+BqrH//5T7+bzzzwT+b574Sx7Vq0PGWG1AAAjwkErvnZ
::7xTwp3riBW80CitzqAzAMyhKBthehL3wGFtnHoSzdgxsl0gfuwj66OXHjInLfmvl8ld97SzMqn17
::rpOBvQ0QvIilH/3pj/4tLTzyvvyLfw7G1mvijx5iAwBqJqBq95AHy42d51+PF1fPzW0AHsEzAC0P
::VToKa+ERdpb3Q61NQTklMvLboY1dfkrfctkXHWP0TzFSPvXobTfa0tqnQ+B5AMRvvoJv/M5zN7+s
::8sI/vAEvJhhbr0Wiy4EhhJlAmgaowPfTQvzrx3etahnEI3gA0HLg6iLU6kHYK8+ztfAIuLpAAEjP
::b4Mx+YpT2vjldypz9ObxY4dPnv0Lv8rr9+T/Sj8+wKYkdLh/164vmKfzxx9UM9+52tj5o2xe8A4i
::ClkwPOQ9gDpE3DCB+Md4rcdKUr/N0QOoLXrSDLC1CLVyAE7xBNvLT0GVpgCAQDq0/LlKG73wlDZ2
::4VdN8+xPGseePrnvN25ibNIHcWSFyPm+V914a66wdPpWbfmJ94EMZV74Lq2pNyAG0MCdHeDQB4IE
::N5nTFWN2DKAudh2wSnDKJ6FKJ+AUj7C99BS4ukTQdEDZ0MxtwNgl83r+3PtHxi/667FXv+e+ie/u
::tfcCwN53i+h7RPyEPzP9+C98ZpdafPp2rB3TaORsMs+5Aca2a+Cb9G7BMBgAUB8TCHR1gdBu/+Aa
::gGcakzTAXoWqLsApHYVTOg5UV6CKh6Cq8+5gXu2Z+mRuZ230gjnKn/+oXjjvi9rIzi9ftLy8JILv
::L4lW/Fz/wU/nSwv8JV546CfZWmLKTZC+5SpoY5fA2HoViPKxxw+LATRy+mYCPCnsy9U6Ut8MgF3x
::WvNQ5RmACGyXoCqz4Oo8VHUeXJmDKs+AnbJrBI11DTq0wk5o5nkrMMafo8LZ/5LbctXdlQvGH30U
::d5exfz9h714RfEZo45YIprf94aPnlg7f+zlUp3+MVw8W1nu7OvSxSxF5iiU4k5MLO8Xpp3bipewU
::ScpNXreUymSGszYNthbd1XbuaAX8jzAhQFnQRs4HjAkFrbBMuW3HOTfxXG70ou+OjF3yDXVO8dA+
::3Kdw0021IREZsc8qHdwTxYTdoDeeuuutzuqRX6fK3GugFnby2rTBqhx+RJone8rCTiqfftQvbXOK
::jEca9Pw5oNwWgBnKKVvQxxa13M4yNFLslE9TfucJaNpJPX/uI1sueOf3KvlPvLBvz02BllyEPmik
::cVNkI8bbP/zE2SXLvEbXlMOqvzdcOiGrdbOEo/ozCUgaGI4yAG2xoFae+eZfvG4F2E3Anrj6ZPq7
::FDrn/wNJyHXBN0OidgAAAABJRU5ErkJggg==
::END_ICON_BASE64
