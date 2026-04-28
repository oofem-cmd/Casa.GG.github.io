@echo off
echo Packing CasaGG Overwolf app...
cd /d "%~dp0"
if exist CasaGG.opk del CasaGG.opk
powershell -NoProfile -Command "Compress-Archive -Path 'app.html','overlay.html','map.html','background.html','background.js','manifest.json','assets' -DestinationPath 'CasaGG_temp.zip' -Force"
ren CasaGG_temp.zip CasaGG.opk
echo.
echo CasaGG.opk created! Upload this file to the Overwolf Developer Console.
pause
