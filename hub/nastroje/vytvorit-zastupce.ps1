# Vytvoří na ploše zástupce „DM Hub“, který spustí hub\DM Hub.cmd v minimalizovaném okně.
# Spuštění (jednou): powershell -ExecutionPolicy Bypass -File hub\nastroje\vytvorit-zastupce.ps1
$ErrorActionPreference = 'Stop'
$hub = Split-Path -Parent $PSScriptRoot
$cil = Join-Path $hub 'DM Hub.cmd'
$plocha = [Environment]::GetFolderPath('Desktop')
$odkaz = Join-Path $plocha 'DM Hub.lnk'
$shell = New-Object -ComObject WScript.Shell
$z = $shell.CreateShortcut($odkaz)
$z.TargetPath = $cil
$z.WorkingDirectory = $hub
$z.WindowStyle = 7   # minimalizované okno
$z.Description = 'DM Hub - ovládací panel kampaně'
$z.Save()
Write-Host "Zástupce vytvořen: $odkaz"
