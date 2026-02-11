@echo off
title Build Antrian KPP - Release Package
echo ================================================
echo   Build Antrian KPP - Release Package
echo ================================================
echo.

:: Create release folder
set RELEASE_DIR=release
if exist %RELEASE_DIR% rmdir /s /q %RELEASE_DIR%
mkdir %RELEASE_DIR%
mkdir %RELEASE_DIR%\server
mkdir %RELEASE_DIR%\server\data
mkdir %RELEASE_DIR%\display

echo.
echo Pilih opsi build:
echo [1] Build TANPA database (fresh install)
echo [2] Build DENGAN database development (include data)
echo.
set /p BUILD_OPTION="Pilihan (1/2): "

echo.
echo ================================================
echo [1/5] Building Web Server...
echo ================================================

:: Check if Go is installed
where go >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Go is not installed!
    echo Please install Go from https://go.dev/dl/
    pause
    exit /b 1
)

:: Build Go executable
echo Compiling Go executable...
go build -o %RELEASE_DIR%\server\antrian-kpp.exe .
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to build Go executable!
    pause
    exit /b 1
)
echo [OK] Server executable built!

:: Copy web assets
echo Copying web assets...
xcopy /E /I /Y /Q web %RELEASE_DIR%\server\web >nul
echo [OK] Web assets copied!

:: Copy config if exists
if exist config.yaml (
    copy /Y config.yaml %RELEASE_DIR%\server\ >nul
    echo [OK] config.yaml copied!
)

:: Copy database based on option
if "%BUILD_OPTION%"=="2" (
    echo.
    echo Copying database...
    if exist data\queue.db (
        copy /Y data\queue.db %RELEASE_DIR%\server\data\ >nul
        echo [OK] Database queue.db copied!
    ) else (
        echo [WARNING] Database not found at data\queue.db
    )
) else (
    echo [INFO] Database will be created fresh on first run
)

:: Create start script for server
echo @echo off > %RELEASE_DIR%\server\start-server.bat
echo title Antrian KPP Server >> %RELEASE_DIR%\server\start-server.bat
echo echo ======================================== >> %RELEASE_DIR%\server\start-server.bat
echo echo   Antrian KPP Server >> %RELEASE_DIR%\server\start-server.bat
echo echo ======================================== >> %RELEASE_DIR%\server\start-server.bat
echo echo. >> %RELEASE_DIR%\server\start-server.bat
echo echo Starting server... >> %RELEASE_DIR%\server\start-server.bat
echo echo Access from this computer: http://localhost:8080 >> %RELEASE_DIR%\server\start-server.bat
echo echo Access from other computers: http://[IP_ADDRESS]:8080 >> %RELEASE_DIR%\server\start-server.bat
echo echo. >> %RELEASE_DIR%\server\start-server.bat
echo echo Press Ctrl+C to stop server >> %RELEASE_DIR%\server\start-server.bat
echo echo. >> %RELEASE_DIR%\server\start-server.bat
echo antrian-kpp.exe >> %RELEASE_DIR%\server\start-server.bat
echo pause >> %RELEASE_DIR%\server\start-server.bat

echo.
echo ================================================
echo [2/5] Checking audio files...
echo ================================================

:: Check if audio files exist
set AUDIO_COUNT=0
if exist electron-display\audio\nomor_antrian.mp3 set /a AUDIO_COUNT+=1
if exist electron-display\audio\angka_1.mp3 set /a AUDIO_COUNT+=1
if exist electron-display\audio\huruf_a.mp3 set /a AUDIO_COUNT+=1

if %AUDIO_COUNT% LSS 3 (
    echo [WARNING] Audio files not found or incomplete!
    echo.
    echo Generating audio files from Google TTS...
    cd electron-display
    node generate-audio.js
    cd ..
    echo.
)

:: Verify audio folder
if exist electron-display\audio (
    for /f %%A in ('dir /b /a-d "electron-display\audio\*.mp3" 2^>nul ^| find /c /v ""') do set AUDIO_FILE_COUNT=%%A
    echo [INFO] Found %AUDIO_FILE_COUNT% audio files
) else (
    echo [WARNING] Audio folder does not exist!
    mkdir electron-display\audio
)

echo.
echo ================================================
echo [3/5] Building Electron Display...
echo ================================================

cd electron-display

:: Check if Node is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    cd ..
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist node_modules (
    echo Installing npm dependencies...
    call npm install
)

:: Build portable
echo Building portable executable...
call npm run build:portable

cd ..

:: Copy Electron build
echo Copying Electron executable...
for %%f in (electron-display\dist\*.exe) do (
    copy /Y "%%f" %RELEASE_DIR%\display\ >nul
    echo [OK] Copied: %%~nxf
)

echo.
echo ================================================
echo [4/5] Copying audio files...
echo ================================================

:: Copy audio folder
if exist electron-display\audio (
    xcopy /E /I /Y /Q electron-display\audio %RELEASE_DIR%\display\audio >nul

    :: Count copied files
    for /f %%A in ('dir /b /a-d "%RELEASE_DIR%\display\audio\*.mp3" 2^>nul ^| find /c /v ""') do set COPIED_AUDIO=%%A
    echo [OK] Copied %COPIED_AUDIO% audio files to release\display\audio\
) else (
    mkdir %RELEASE_DIR%\display\audio
    echo [WARNING] No audio files to copy!
)

:: Check for bell.mp3
if not exist %RELEASE_DIR%\display\audio\bell.mp3 (
    echo.
    echo [WARNING] bell.mp3 not found!
    echo          Download from https://freesound.org/ and add to audio folder
)

:: Copy config.json
copy /Y electron-display\config.json %RELEASE_DIR%\display\ >nul
echo [OK] config.json copied!

:: Copy local-tts.js (needed for audio playback)
copy /Y electron-display\local-tts.js %RELEASE_DIR%\display\ >nul
echo [OK] local-tts.js copied!

echo.
echo ================================================
echo [5/5] Creating documentation...
echo ================================================

:: Create README for release
(
echo ================================================================================
echo                    ANTRIAN KPP - RELEASE PACKAGE
echo ================================================================================
echo.
echo STRUKTUR FOLDER:
echo.
echo   release/
echo   ├── server/                 # UNTUK KOMPUTER SERVER
echo   │   ├── antrian-kpp.exe     # Aplikasi server
echo   │   ├── start-server.bat    # Klik untuk menjalankan server
echo   │   ├── data/               # Database
echo   │   │   └── queue.db        # File database SQLite
echo   │   └── web/                # Assets web
echo   │
echo   └── display/                # UNTUK KOMPUTER TV/DISPLAY
echo       ├── Antrian Display*.exe # Aplikasi display
echo       ├── config.json          # EDIT FILE INI!
echo       └── audio/               # File suara
echo.
echo ================================================================================
echo                         PANDUAN INSTALASI
echo ================================================================================
echo.
echo KOMPUTER SERVER:
echo ----------------
echo 1. Copy folder 'server' ke komputer server
echo 2. Double-click 'start-server.bat' untuk menjalankan
echo 3. Buka Windows Firewall, izinkan port 8080
echo 4. Catat IP address server ^(jalankan: ipconfig^)
echo.
echo KOMPUTER DISPLAY/TV:
echo --------------------
echo 1. Copy folder 'display' ke komputer yang terhubung ke TV
echo 2. PENTING: Edit file 'config.json'
echo    - Ganti "localhost" dengan IP address server
echo    - Contoh: "serverUrl": "http://192.168.1.100:8080"
echo 3. Double-click 'Antrian Display*.exe' untuk menjalankan
echo.
echo ================================================================================
echo                          KEYBOARD SHORTCUTS
echo ================================================================================
echo.
echo Di aplikasi Display:
echo   F5              = Refresh halaman
echo   F11             = Toggle fullscreen
echo   Ctrl+Shift+D    = Buka DevTools ^(debugging^)
echo   Ctrl+Shift+L    = Test audio lokal
echo   Ctrl+Q          = Keluar aplikasi
echo.
echo ================================================================================
echo                           TROUBLESHOOTING
echo ================================================================================
echo.
echo Display tidak konek ke server:
echo   - Pastikan server sudah berjalan
echo   - Cek IP address di config.json sudah benar
echo   - Cek firewall sudah dibuka port 8080
echo   - Pastikan komputer dalam jaringan yang sama
echo.
echo Audio tidak berbunyi:
echo   - Pastikan folder 'audio' berisi file MP3
echo   - Cek volume Windows tidak mute
echo   - Tekan Ctrl+Shift+L untuk test audio
echo.
echo ================================================================================
) > %RELEASE_DIR%\README.txt

echo [OK] README.txt created!

:: Create config template
(
echo {
echo   "serverUrl": "http://GANTI_DENGAN_IP_SERVER:8080",
echo   "displayPath": "/display",
echo   "fullscreen": true,
echo   "kiosk": true,
echo   "devTools": false,
echo   "useLocalTTS": true
echo }
) > %RELEASE_DIR%\display\config.json.template

echo [OK] config.json.template created!

echo.
echo ================================================
echo              BUILD COMPLETE!
echo ================================================
echo.
echo Release package created in: %RELEASE_DIR%\
echo.
echo Contents:
echo   server\
echo     - antrian-kpp.exe
echo     - start-server.bat
echo     - web\ ^(assets^)
if "%BUILD_OPTION%"=="2" (
echo     - data\queue.db ^(DATABASE INCLUDED^)
) else (
echo     - data\ ^(empty, will be created on first run^)
)
echo.
echo   display\
echo     - Antrian Display*.exe

:: Count and show audio files
for /f %%A in ('dir /b /a-d "%RELEASE_DIR%\display\audio\*.mp3" 2^>nul ^| find /c /v ""') do set FINAL_AUDIO=%%A
echo     - audio\ ^(%FINAL_AUDIO% files^)
echo     - config.json ^(EDIT SERVERURL!^)
echo.
echo ------------------------------------------------
echo NEXT STEPS:
echo ------------------------------------------------
echo 1. Copy 'server' folder to server computer
echo 2. Copy 'display' folder to TV computer
echo 3. Edit display\config.json - change serverUrl
echo 4. Run start-server.bat on server
echo 5. Run Antrian Display.exe on TV
echo.
if not exist %RELEASE_DIR%\display\audio\bell.mp3 (
echo [!] REMINDER: Add bell.mp3 to display\audio\
echo.
)
pause
