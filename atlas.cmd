@echo off
rem ATLAS local hosting launcher for Windows. Usage: atlas start | stop | restart | status | logs | backup | restore | update | test
node "%~dp0scripts\atlas.mjs" %*
