@echo off
cd /d "%~dp0"
title MathArt

echo ============================================
echo            M A T H A R T
echo ============================================
echo.

REM --- Node.js уже доступен? ---
where npm >nul 2>nul
if not errorlevel 1 goto :DEPS

REM --- Может, Node.js стоит, но PATH не обновился в этом окне ---
if exist "C:\Program Files\nodejs\npm.cmd" (
    set "PATH=%PATH%;C:\Program Files\nodejs"
    goto :DEPS
)

REM --- Скачиваем и ставим Node.js LTS автоматически ---
echo Node.js не найден - ставлю автоматически.
echo.
echo Скачиваю установщик Node.js LTS с nodejs.org ...
set "MSI=%TEMP%\node-lts-x64.msi"
set "URL=https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
curl -L -s -o "%MSI%" "%URL%"
if not exist "%MSI%" powershell -NoProfile -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%MSI%'"
if not exist "%MSI%" goto :DLFAIL

echo Устанавливаю Node.js ...
echo Если появится окно разрешения - нажми "Да".
powershell -NoProfile -Command "Start-Process msiexec -ArgumentList '/i','%MSI%','/quiet','/norestart' -Verb RunAs -Wait"
del "%MSI%" >nul 2>nul
set "PATH=%PATH%;C:\Program Files\nodejs"
where npm >nul 2>nul
if errorlevel 1 goto :NOFAIL
echo Node.js установлен!
echo.
goto :DEPS

:DLFAIL
echo [ОШИБКА] Не удалось скачать Node.js.
echo Проверь интернет или установи вручную: https://nodejs.org
pause
exit /b 1

:NOFAIL
echo [ОШИБКА] Установка Node.js отменена или не удалась.
echo Установи вручную: https://nodejs.org и запусти батник снова.
pause
exit /b 1

:DEPS
if exist "node_modules\.bin\vite.cmd" goto :RUN
echo Устанавливаю зависимости игры ...
echo Это займет 1-3 минуты, дальше запуск будет мгновенным.
echo.
call npm install
if errorlevel 1 goto :DEPFAIL
if not exist "node_modules\.bin\vite.cmd" goto :DEPFAIL
echo.
goto :RUN

:DEPFAIL
echo.
echo [ОШИБКА] Не удалось скачать зависимости.
echo Проверь интернет, брандмауэр/антивирус и повтори запуск батника.
pause
exit /b 1

:RUN
echo Запускаю сервер игры ...
echo.
echo    Браузер откроется сам: http://localhost:5173/
echo    Если страница пустая - подожди пару секунд и нажми F5.
echo    Игра с друзьями: они открывают адрес из строки Network ниже
echo    и вводят код комнаты с твоего экрана. Коды WebRTC не нужны.
echo    Своя музыка: положи mp3/ogg/wav в папку music - треки будут играть
echo    у всех игроков на сервере (первыми в ротации).
echo    Чтобы закрыть игру - просто закрой это окно.
echo.
start "" http://localhost:5173/
call npm run dev -- --host
pause
exit /b 0