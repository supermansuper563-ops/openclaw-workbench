@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "WORKBENCH_CHECK_ONLY="
set "WORKBENCH_EXPECT_MODE_VALUE="
for %%A in (%*) do call :inspect_arg "%%~A"
goto :args_scanned

:inspect_arg
if defined WORKBENCH_EXPECT_MODE_VALUE (
  if /I "%~1"=="Doctor" set "WORKBENCH_CHECK_ONLY=1"
  set "WORKBENCH_EXPECT_MODE_VALUE="
  exit /b 0
)
if /I "%~1"=="-DryRun" set "WORKBENCH_CHECK_ONLY=1"
if /I "%~1"=="-Mode" set "WORKBENCH_EXPECT_MODE_VALUE=1"
if /I "%~1"=="-Mode:Doctor" set "WORKBENCH_CHECK_ONLY=1"
exit /b 0

:args_scanned
set "WORKBENCH_PWSH="
where pwsh.exe >nul 2>&1
if not errorlevel 1 set "WORKBENCH_PWSH=pwsh.exe"
if not defined WORKBENCH_PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "WORKBENCH_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"

if not defined WORKBENCH_PWSH (
  if defined WORKBENCH_CHECK_ONLY (
    echo PowerShell 7 is required to run Workbench setup checks.
    echo No package was installed because Doctor and DryRun are check-only modes.
    exit /b 1
  )
  where winget.exe >nul 2>&1
  if errorlevel 1 (
    echo PowerShell 7 is required and winget is unavailable.
    echo Install Microsoft PowerShell from its official source, then run this launcher again.
    pause
    exit /b 1
  )
  echo Installing the official Microsoft.PowerShell package with winget...
  winget.exe install --id Microsoft.PowerShell --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
  if errorlevel 1 (
    echo PowerShell 7 installation did not complete.
    pause
    exit /b 1
  )
  if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "WORKBENCH_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
)

if not defined WORKBENCH_PWSH (
  echo PowerShell 7 was installed but could not be located. Reopen this launcher.
  pause
  exit /b 1
)

"%WORKBENCH_PWSH%" -NoLogo -NoProfile -File "%~dp0workbench\install.ps1" %*
if errorlevel 1 (
  echo.
  echo OpenClaw Workbench setup did not complete. Review the message above.
  pause
  exit /b 1
)
endlocal
