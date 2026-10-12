@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: Larp Tool - full Vencord setup per https://docs.vencord.dev/installing/
::
::   auto-setup.bat              clone, plugin, build, patch Discord
::   auto-setup.bat rebuild      copy plugin + rebuild only
::   auto-setup.bat inject       rebuild + patch Discord
::   auto-setup.bat patch        patch Discord only (no rebuild)
::
::   VENCORD_DIR, DISCORD_BRANCH=stable|ptb|canary|auto, DISCORD_LOCATION
::   NOINJECT=1, KEEP_DISCORD_OPEN=1

set "ROOT=%~dp0"
set "PLUGIN_SRC=%ROOT%larp\index.tsx"
set "PATCH_SCRIPT=%ROOT%patch-discord.mjs"
set "PLUGIN_NAME=larp"
set "VENCORD_REPO=https://github.com/Vendicated/Vencord"
set "EXITCODE=0"

if not defined VENCORD_DIR set "VENCORD_DIR=%LOCALAPPDATA%\Vencord-custom"
set "USERPLUGIN_DIR=%VENCORD_DIR%\src\userplugins\%PLUGIN_NAME%"
set "MODE=%~1"
if not defined MODE set "MODE=setup"
if not defined DISCORD_BRANCH set "DISCORD_BRANCH=stable"

title Larp Tool - Vencord Setup
goto :main

:finish
echo.
echo ============================================================
echo   Done!
echo ============================================================
echo   Build: %VENCORD_DIR%\dist
echo.
if /I "%MODE%"=="rebuild" (
    echo   Rebuild only - Discord was NOT patched.
    echo   Run: auto-setup.bat inject
) else if /I "%MODE%"=="patch" (
    echo   Discord patched. Fully quit Discord ^(tray too^), then reopen.
) else if defined NOINJECT (
    echo   Build only ^(NOINJECT=1^). Run: auto-setup.bat inject
) else (
    echo   Next steps:
    echo     1. Fully quit Discord ^(system tray too^), then reopen
    echo     2. Settings should show a Vencord section
    echo     3. Vencord Settings ^> Plugins ^> enable "Larp Tool"
    echo     4. Ctrl+B to open
)
echo.
echo   After editing larp\index.tsx:  auto-setup.bat inject
echo   After Discord updates itself:  auto-setup.bat patch
echo.
pause
exit /b %EXITCODE%

:failed
echo.
echo [FAILED] setup did not complete.
echo.
pause
exit /b 1

:main
echo.
echo ============================================================
echo   Larp Tool - Vencord auto setup
echo ============================================================
echo   Plugin:  %PLUGIN_SRC%
echo   Vencord: %VENCORD_DIR%
echo   Mode:    %MODE%
if defined DISCORD_LOCATION (echo   Discord: %DISCORD_LOCATION%) else (echo   Discord branch: %DISCORD_BRANCH%)
echo ============================================================
echo.

if /I "%MODE%"=="help" goto :show_help
if /I "%MODE%"=="/?" goto :show_help
if /I "%MODE%"=="-h" goto :show_help

if not exist "%PLUGIN_SRC%" (
    echo [ERROR] Plugin not found: %PLUGIN_SRC%
    goto :failed
)
if not exist "%PATCH_SCRIPT%" (
    echo [ERROR] Patch script not found: %PATCH_SCRIPT%
    goto :failed
)

call :ensure_tool git
if errorlevel 1 goto :failed
call :ensure_tool node
if errorlevel 1 goto :failed

if /I "%MODE%"=="patch" (
    call :patch_discord
    if errorlevel 1 goto :failed
    goto :finish
)

call :ensure_pnpm
if errorlevel 1 goto :failed

if /I not "%MODE%"=="rebuild" if /I not "%MODE%"=="inject" (
    call :clone_or_update_vencord
    if errorlevel 1 goto :failed
)

if /I "%MODE%"=="inject" (
    if not exist "%VENCORD_DIR%\src" (
        echo [ERROR] Vencord not found at %VENCORD_DIR%
        echo         Run auto-setup.bat once with no args first.
        goto :failed
    )
)

call :install_plugin
if errorlevel 1 goto :failed
call :install_deps
if errorlevel 1 goto :failed
call :build_vencord
if errorlevel 1 goto :failed

if /I "%MODE%"=="inject" set "NOINJECT="
if defined NOINJECT goto :finish
if /I "%MODE%"=="rebuild" goto :finish

call :patch_discord
if errorlevel 1 goto :failed
goto :finish

:show_help
echo.
echo Usage:
echo   auto-setup.bat              Clone Vencord, install plugin, build, patch Discord
echo   auto-setup.bat rebuild      Copy larp\index.tsx and rebuild (no patch)
echo   auto-setup.bat inject       Rebuild and patch Discord
echo   auto-setup.bat patch        Patch Discord only (after Discord updates)
echo.
echo Environment:
echo   VENCORD_DIR         Vencord folder (default: %%LOCALAPPDATA%%\Vencord-custom)
echo   DISCORD_BRANCH      stable ^| ptb ^| canary ^| auto  (default: stable)
echo   DISCORD_LOCATION    Custom Discord install path
echo   NOINJECT=1          Skip patching Discord
echo.
pause
exit /b 0

:ensure_tool
echo [..] checking %~1...
set "TOOLRESULT=%TEMP%\larp-ensure-%~1.txt"
if exist "%TOOLRESULT%" del /f /q "%TOOLRESULT%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%ROOT%ensure-tools.ps1" -Tool %~1 -ResultFile "%TOOLRESULT%"
if errorlevel 1 (
    echo [ERROR] could not install %~1
    exit /b 1
)
set "TOOLLINE="
if exist "%TOOLRESULT%" set /p TOOLLINE=<"%TOOLRESULT%"
if defined TOOLLINE set "PATH=%TOOLLINE%;%PATH%"
where %~1 >nul 2>&1
if errorlevel 1 (
    echo [ERROR] %~1 is still not available after install
    exit /b 1
)
echo [OK] %~1
exit /b 0

:ensure_pnpm
call :add_npm_global_path
where pnpm.cmd >nul 2>&1
if not errorlevel 1 (
    echo [OK] pnpm
    exit /b 0
)

echo [..] pnpm missing - installing via npm (this can take 1-2 minutes)...
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found. Reinstall Node.js from https://nodejs.org/
    exit /b 1
)

call npm.cmd install -g pnpm@9
if errorlevel 1 (
    echo [WARN] npm global install failed, trying corepack...
    where corepack.cmd >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] could not install pnpm
        exit /b 1
    )
    echo [..] corepack enable...
    call corepack.cmd enable
    echo [..] corepack prepare pnpm@9.15.0 --activate
    call corepack.cmd prepare pnpm@9.15.0 --activate
)

call :add_npm_global_path
where pnpm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm still not available after install
    echo         Try manually: npm install -g pnpm@9
    exit /b 1
)

echo [OK] pnpm ready
call pnpm.cmd --version
exit /b 0

:add_npm_global_path
if exist "%APPDATA%\npm\pnpm.cmd" set "PATH=%APPDATA%\npm;%PATH%"
where npm.cmd >nul 2>&1
if errorlevel 1 exit /b 0
set "NPM_PREFIX="
for /f "delims=" %%P in ('npm.cmd prefix -g 2^>nul') do set "NPM_PREFIX=%%P"
if defined NPM_PREFIX set "PATH=%NPM_PREFIX%;%PATH%"
exit /b 0

:clone_or_update_vencord
if exist "%VENCORD_DIR%\.git" (
    echo [..] updating Vencord repo...
    pushd "%VENCORD_DIR%"
    set "GIT_ASK_YESNO=false"
    set "GIT_TERMINAL_PROMPT=0"
    call git -c core.fsmonitor=false -c gc.auto=0 fetch --prune --quiet
    call git -c core.fsmonitor=false -c gc.auto=0 merge --ff-only origin/main
    set "ERR=!ERRORLEVEL!"
    if not "!ERR!"=="0" (
        echo [WARN] ff-only merge failed, trying pull...
        call git -c core.fsmonitor=false -c gc.auto=0 pull --ff-only --no-rebase
        set "ERR=!ERRORLEVEL!"
    )
    popd
    if not "!ERR!"=="0" echo [WARN] git update failed, using existing copy
    echo [OK] Vencord at %VENCORD_DIR%
    exit /b 0
)
echo [..] cloning Vencord...
if not exist "%VENCORD_DIR%" mkdir "%VENCORD_DIR%"
git clone "%VENCORD_REPO%" "%VENCORD_DIR%"
if errorlevel 1 (
    echo [ERROR] git clone failed
    exit /b 1
)
echo [OK] cloned to %VENCORD_DIR%
exit /b 0

:install_plugin
echo [..] copying plugin to src\userplugins\%PLUGIN_NAME%\
if not exist "%VENCORD_DIR%\src" (
    echo [ERROR] %VENCORD_DIR%\src missing
    exit /b 1
)
if not exist "%VENCORD_DIR%\src\userplugins" mkdir "%VENCORD_DIR%\src\userplugins"
if not exist "%USERPLUGIN_DIR%" mkdir "%USERPLUGIN_DIR%"
copy /Y "%PLUGIN_SRC%" "%USERPLUGIN_DIR%\index.tsx" >nul || exit /b 1
echo [OK] %USERPLUGIN_DIR%\index.tsx
exit /b 0

:install_deps
echo [..] pnpm install --frozen-lockfile
pushd "%VENCORD_DIR%"
call pnpm.cmd install --frozen-lockfile
set "ERR=!ERRORLEVEL!"
popd
if not "!ERR!"=="0" (
    echo [WARN] retrying without --frozen-lockfile...
    pushd "%VENCORD_DIR%"
    call pnpm.cmd install
    set "ERR=!ERRORLEVEL!"
    popd
)
if not "!ERR!"=="0" (
    echo [ERROR] pnpm install failed
    exit /b 1
)
echo [OK] deps installed
exit /b 0

:build_vencord
echo [..] pnpm build
pushd "%VENCORD_DIR%"
call pnpm.cmd build
set "ERR=!ERRORLEVEL!"
popd
if not "!ERR!"=="0" (
    echo [ERROR] pnpm build failed
    exit /b 1
)
if not exist "%VENCORD_DIR%\dist\patcher.js" (
    echo [ERROR] build finished but dist\patcher.js is missing
    exit /b 1
)
echo [OK] %VENCORD_DIR%\dist
exit /b 0

:patch_discord
echo [..] patching Discord (direct, verified)...
:: IMPORTANT: do NOT use VencordInstallerCli with VENCORD_DEV_INSTALL=1.
:: That path reports Success without renaming app.asar, which leaves Discord
:: unpatched (or unpatches it if we uninstall first).
if defined DISCORD_LOCATION (
    call node "%PATCH_SCRIPT%" --vencord "%VENCORD_DIR%" --discord "%DISCORD_LOCATION%" --branch %DISCORD_BRANCH%
) else (
    call node "%PATCH_SCRIPT%" --vencord "%VENCORD_DIR%" --branch %DISCORD_BRANCH%
)
set "ERR=!ERRORLEVEL!"
if not "!ERR!"=="0" (
    echo [ERROR] patch failed
    echo         Make sure Discord is fully closed, then try: auto-setup.bat patch
    echo         Or set DISCORD_LOCATION to your Discord folder.
    exit /b 1
)
exit /b 0
