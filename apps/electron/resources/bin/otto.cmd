@echo off
set "OTTO_BUN_BIN=%OTTO_BUN%"
if "%OTTO_BUN_BIN%"=="" set "OTTO_BUN_BIN=bun"
"%OTTO_BUN_BIN%" "%~dp0..\scripts\otto.mjs" %*
