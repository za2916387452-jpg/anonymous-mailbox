@echo off
cd /d "%~dp0"

set "APP_NODE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined APP_NODE set "APP_NODE=%%I"

if not defined APP_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "APP_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined APP_NODE goto node_missing

echo Starting anonymous mailbox...
echo Student page: http://localhost:3000/
echo Teacher page: http://localhost:3000/admin
echo Keep this window open while the mailbox is running.
echo.

"%APP_NODE%" server.js
goto finished

:node_missing
echo Node.js was not found.
echo Install Node.js 20 or newer, then run this file again.
goto finished

:finished
echo.
echo The server has stopped.
pause
