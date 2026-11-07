@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Could not find the project virtual environment:
  echo   %~dp0.venv\Scripts\python.exe
  exit /b 1
)

if not exist "data\logs" mkdir "data\logs"

rem Start detached and hidden. PowerShell owns the child process, so this batch
rem window can exit immediately while the worker keeps running in the background.
powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "$root='%~dp0'; $log=$root+'data\logs\worker-daemon.out'; $err=$root+'data\logs\worker-daemon.err'; Start-Process -FilePath ($root+'.venv\Scripts\python.exe') -ArgumentList @('-m','worker.run') -WorkingDirectory $root -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden"
exit /b 0
