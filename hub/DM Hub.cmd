@echo off
rem DM Hub - spusti server a otevre panel. Okno nech minimalizovane, jeho zavrenim Hub skonci.
chcp 65001 >nul
cd /d "%~dp0"
title DM Hub
where node >nul 2>nul || (echo Node.js neni nainstalovany. Viz ZADANI.md, Priprava domaciho PC. & pause & exit /b 1)
if not exist node_modules (
  echo Instaluji zavislosti, jen poprve...
  call npm ci || (pause & exit /b 1)
)
node spoustec.js
if errorlevel 1 pause
