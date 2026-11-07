
@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM   SocialScheduler - Start (Windows)
REM   Double-click this file to run SocialScheduler.
REM
REM   Starts the worker and dashboard, then opens the browser.
REM ============================================================

REM Work from the folder this script lives in (the repo root).
cd /d "%~dp0"

echo ==========================================
echo   SocialScheduler
echo ==========================================
echo.

REM ---- 1. Preflight: required software. ----
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js isn't installed. Get it from https://nodejs.org ^(choose LTS^), then run this again.
    echo.
    pause
    exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
    echo Python 3 isn't installed. Get it from https://www.python.org/downloads/ , then run this again.
    echo.
    pause
    exit /b 1
)

REM ---- 2. First-run config. ----
if not exist ".env" if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created .env from the template. Add your Meta credentials there when ready.
    echo.
)

REM ---- 3. Prepare database. ----
echo Preparing the database...
python migrate.py
if errorlevel 1 (
    echo Database setup failed ^(see the message above^).
    echo.
    pause
    exit /b 1
)
echo.

REM ---- 4. Install dashboard dependencies on first run. ----
if not exist "dashboard\node_modules" (
    echo First run - installing dashboard dependencies ^(this can take a minute^)...
    pushd dashboard
    call npm install
    if errorlevel 1 (
        popd
        echo Installing dashboard dependencies failed ^(see above^).
        echo.
        pause
        exit /b 1
    )
    popd
    echo.
)

REM ---- 5. Set up worker Python environment on first run. ----
if not exist ".venv" (
    echo First run - setting up the worker ^(this can take a minute^)...
    python -m venv .venv
    if errorlevel 1 (
        echo Couldn't create the Python environment.
        echo.
        pause
        exit /b 1
    )
    ".venv\Scripts\python" -m pip install --quiet --upgrade pip
    ".venv\Scripts\pip" install -r requirements.txt
    if errorlevel 1 (
        echo Installing worker dependencies failed ^(see above^).
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM ---- 5c. Ensure cloudflared is available. ----
".venv\Scripts\python" -m worker.cloudflared_setup

REM ---- 5d. Ensure ffmpeg is available. ----
".venv\Scripts\python" -m worker.ffmpeg_setup

REM ---- 6. Check whether the application is already running. ----
set PORT=3939
set "RUN_DIR=%~dp0data\run"
set "LOG_DIR=%~dp0data\logs"

if not exist "%RUN_DIR%" mkdir "%RUN_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "ALREADY="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr LISTENING') do set "ALREADY=%%a"

if defined ALREADY (
    echo SocialScheduler is already running.
    echo Opening https://sm.shopmanyworlds.com:%PORT%
    echo.
    start "" "https://sm.shopmanyworlds.com:%PORT%"
    exit /b 0
)

REM ---- 7. Start the worker. ----
set "TASKNAME=SocialSchedulerWorker"
call :env_value DRY_RUN DRY_RUN
call :env_value KILL_SWITCH KILL_SWITCH

if "!DRY_RUN!"=="0" (
    where cloudflared >nul 2>nul
    if errorlevel 1 if not exist "data\bin\cloudflared.exe" (
        echo [!] cloudflared isn't available - required for real publishing.
        echo     Check your internet connection or install it from:
        echo     https://github.com/cloudflare/cloudflared/releases/latest
        echo.
    )
)

if not "!DRY_RUN!"=="0" (
    echo Worker: DRY-RUN is on in .env - it will show what it WOULD post and publish nothing.
) else (
    if "!KILL_SWITCH!"=="1" (
        echo Worker: KILL_SWITCH is on in .env - it will run but publish nothing.
    ) else (
        echo Worker: publishing for real ^(DRY_RUN=0 in .env^).
    )
)

set "MANUAL_WORKER=0"
REM Recreate the task so installs made with the old overlong /TR action are
REM repaired automatically instead of being reused forever.
schtasks /Delete /TN "%TASKNAME%" /F >NUL 2>&1
schtasks /Query /TN "%TASKNAME%" >NUL 2>&1

if not errorlevel 1 (
    schtasks /Run /TN "%TASKNAME%" >NUL 2>&1
    echo Worker scheduled to start automatically at logon.
) else (
    echo Setting up worker autostart...

    > "!RUN_DIR!\run-worker-autostart.cmd" echo @echo off
    >>"!RUN_DIR!\run-worker-autostart.cmd" echo cd /d "%~dp0"
    >>"!RUN_DIR!\run-worker-autostart.cmd" echo ".venv\Scripts\python" -m worker.run ^>^> "!LOG_DIR!\worker-autostart.out" 2^>^&1

    > "!RUN_DIR!\run-worker-autostart.ps1" echo $ErrorActionPreference = 'Continue'
    >>"!RUN_DIR!\run-worker-autostart.ps1" echo Set-Location -LiteralPath '%~dp0'
    >>"!RUN_DIR!\run-worker-autostart.ps1" echo ^& '.venv\Scripts\python.exe' -m worker.run ^>^> 'data\logs\worker-autostart.out' 2^>^&1

    if exist "!RUN_DIR!\watchdog.pid" (
        set /p WD_PID=<"!RUN_DIR!\watchdog.pid"
        taskkill /PID !WD_PID! /T /F >NUL 2>&1
        del /q "!RUN_DIR!\watchdog.pid" "!RUN_DIR!\worker.deadline" >NUL 2>&1
    )

    REM Keep the scheduled-task action short. Windows rejects /TR commands over
    REM 261 characters. PowerShell is launched hidden so no worker CMD window appears.
    schtasks /Create /F /SC ONLOGON /TN "%TASKNAME%" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"!RUN_DIR!\run-worker-autostart.ps1\"" >"!LOG_DIR!\autostart-register.log" 2>&1

    if errorlevel 1 (
        echo Could not register scheduled task. Trying Startup folder...
        set "STARTUP_LNK="
        for /f "usebackq delims=" %%S in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\startup-shortcut.ps1" -Target "!RUN_DIR!\run-worker-autostart.cmd" -Shim "%~dp0scripts\run-hidden.ps1"`) do set "STARTUP_LNK=%%S"

        if defined STARTUP_LNK (
            echo Worker registered in your Startup folder.
        ) else (
            echo WARNING: Worker autostart registration failed.
            echo Check "!LOG_DIR!\autostart-register.log"
        )
        set "MANUAL_WORKER=1"
    ) else (
        schtasks /Run /TN "%TASKNAME%" >NUL 2>&1
        echo Worker will start automatically at logon.
    )
)
echo.

REM ---- 8. Start a session-only worker if autostart failed. ----
if "!MANUAL_WORKER!"=="1" (
    echo Starting the worker in the background...

    > "!RUN_DIR!\run-worker.cmd" echo @echo off
    >>"!RUN_DIR!\run-worker.cmd" echo cd /d "%~dp0"
    >>"!RUN_DIR!\run-worker.cmd" echo ".venv\Scripts\python" -m worker.run ^>^> "!LOG_DIR!\worker-daemon.out" 2^>^&1

    set "WORKER_PID="
    for /f %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-hidden.ps1" "!RUN_DIR!\run-worker.cmd"') do set "WORKER_PID=%%p"

    echo !WORKER_PID!| findstr /r "^[0-9][0-9]*$" >NUL
    if errorlevel 1 (
        echo WARNING: Worker did not start. Check data\logs\worker-daemon.out
    ) else (
        >"!RUN_DIR!\worker.pid" echo !WORKER_PID!
        echo Worker running in the background.
    )
    echo.
)

REM ---- 8b. Guaranteed session worker fallback. ----
REM Task Scheduler can report success while the task action is later rejected.
REM Verify the lock owner is alive; if it is stale, remove only that lock and
REM start the worker directly, hidden, with output captured.
powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "$root='%~dp0'; $lock=Join-Path $root 'data\run\worker.lock'; $ownerPid=0; if (Test-Path -LiteralPath $lock) { $raw=(Get-Content -LiteralPath $lock -Raw).Trim(); [int]::TryParse($raw,[ref]$ownerPid) | Out-Null }; $alive=$false; if ($ownerPid -gt 0) { $alive=$null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) }; if (-not $alive) { Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue; Start-Process -FilePath (Join-Path $root '.venv\Scripts\python.exe') -ArgumentList @('-m','worker.run') -WorkingDirectory $root -RedirectStandardOutput (Join-Path $root 'data\logs\worker-daemon.out') -RedirectStandardError (Join-Path $root 'data\logs\worker-daemon.err') -WindowStyle Hidden }"

REM HTTPS uses this install's local certificate (private key stays under data).
if not exist "data\certs\dashboard-key.pem" (
    echo HTTPS certificate is missing. Restore data\certs before starting the dashboard.
    pause
    exit /b 1
)
if not exist "data\certs\dashboard-cert.pem" (
    echo HTTPS certificate is missing. Restore data\certs before starting the dashboard.
    pause
    exit /b 1
)

REM ---- 9. Start dashboard using Webpack instead of Turbopack. ----
echo Starting the dashboard...

> "%RUN_DIR%\run-dashboard.cmd" echo @echo off
>>"%RUN_DIR%\run-dashboard.cmd" echo cd /d "%~dp0dashboard"
>>"%RUN_DIR%\run-dashboard.cmd" echo set PORT=%PORT%
>>"%RUN_DIR%\run-dashboard.cmd" echo npm run dev -- --webpack --hostname 127.0.0.1 --experimental-https --experimental-https-key ../data/certs/dashboard-key.pem --experimental-https-cert ../data/certs/dashboard-cert.pem ^> "%LOG_DIR%\dashboard.log" 2^>^&1

set "DASH_PID="
for /f %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-hidden.ps1" "%RUN_DIR%\run-dashboard.cmd"') do set "DASH_PID=%%p"

if defined DASH_PID >"%RUN_DIR%\dashboard.pid" echo !DASH_PID!

REM Wait up to 90 seconds for dashboard readiness.
set "READY="
for /l %%i in (1,1,90) do (
    if not defined READY (
        curl -sf -o NUL https://sm.shopmanyworlds.com:%PORT% && set "READY=1"
        if not defined READY timeout /t 1 /nobreak >NUL
    )
)

if defined READY (
    start "" "https://sm.shopmanyworlds.com:%PORT%"
    echo [OK] Running at https://sm.shopmanyworlds.com:%PORT%
) else (
    echo [!] The dashboard did not start within 90 seconds.
    echo     Check data\logs\dashboard.log
    echo     You can retry at https://sm.shopmanyworlds.com:%PORT%
)

echo.
echo Startup finished.
echo To stop it, double-click Stop-SocialScheduler-Windows.bat
echo.
exit /b 0

REM ---- Helper: read a key from .env. Last match wins. ----
:env_value
set "%2="
if not exist ".env" goto :eof

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "k=%%A"
    set "k=!k: =!"
    if /i "!k!"=="%1" (
        set "v=%%B"
        set "v=!v: =!"
        set "%2=!v!"
    )
)
goto :eof
