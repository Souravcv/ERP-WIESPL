@echo off
rem Signs the release APK with the WIESPL key. It asks for the key password; the password is not stored.
rem First build it: in android-app\android run gradlew.bat assembleRelease
set "JAVA_HOME=D:\Android\jdk21"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "HERE=%~dp0android"
call "D:\Android\sdk\build-tools\36.0.0\apksigner.bat" sign --ks "%HERE%\wiespl-attendance.jks" --ks-key-alias wiespl --out "D:\Android\WIESPL-Attendance.apk" "%HERE%\app\build\outputs\apk\release\app-release-unsigned.apk"
if errorlevel 1 (echo Signing failed: nothing was made.) else (echo Done: D:\Android\WIESPL-Attendance.apk - send this file to the phones.)
pause
