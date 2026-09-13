@echo off
REM Sanction Loader - publish script (Windows).
REM
REM   build.cmd                 self-contained single file .exe (end users)
REM                               downloads runtime packs from nuget.org
REM   build.cmd small           framework-dependent, win-x64 (~2 MB,
REM                               needs .NET 8 Desktop Runtime on the PC)
REM   build.cmd portable        framework-dependent, no RID: no NuGet downloads
REM                               at all - use when nuget.org is blocked/slow
REM   build.cmd api https://... re-embed API URL + server key, then publish
REM
REM Output: loader\dist\Sanction.Loader.exe
REM Log:    loader\build.log  (attach this file when asking for help)

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "MODE=self-contained"
set "API="

if /i "%~1"=="small"    set "MODE=framework-dependent"
if /i "%~1"=="portable" set "MODE=portable"
if /i "%~1"=="api"      set "API=%~2"

where dotnet >nul 2>nul
if errorlevel 1 (
  echo [!] dotnet SDK ne najden.
  echo     Ustanovite .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0
  echo     Posle ustanovki otkrojte NOVUJU komandnuju stroku i povtorite.
  exit /b 1
)

echo -^> dotnet SDK
for /f "delims=. tokens=1" %%V in ('dotnet --version 2^>nul') do set "SDKMAJOR=%%V"
dotnet --version
if not defined SDKMAJOR (
  echo [!] Ne udalos' prochitat' versiyu SDK.
  exit /b 1
)
if %SDKMAJOR% LSS 8 (
  echo [!] SDK %SDKMAJOR%.x: proekt celitsya v net8.0-windows, nuzhen .NET 8 SDK ili novej.
  echo     Bez etogo publish upadyot s NETSDK1045.
  echo     Skachat: https://dotnet.microsoft.com/download/dotnet/8.0
  exit /b 1
)

if not "%API%"=="" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [!] Rezhim "api" trebuet Node.js - on nuzhen dlya embed-loader-config.js
    exit /b 1
  )
  echo -^> vshivaem adres API i kluch servera: %API%
  pushd ..
  node tools\embed-loader-config.js %API%
  if errorlevel 1 ( popd & exit /b 1 )
  popd
)

set "SELF=true"
set "RID=-r win-x64"
if "%MODE%"=="framework-dependent" set "SELF=false"
if "%MODE%"=="portable" (
  set "SELF=false"
  set "RID="
)

echo -^> dotnet publish ^(%MODE%, single file^)
if exist dist rmdir /s /q dist
if exist build.log del /q build.log

dotnet publish Sanction.Loader\Sanction.Loader.csproj ^
  -c Release ^
  %RID% ^
  --self-contained %SELF% ^
  -p:PublishSingleFile=true ^
  -p:IncludeNativeLibrariesForSelfExtract=true ^
  -p:EnableCompressionInSingleFile=true ^
  -p:DebugType=none ^
  -p:DebugSymbols=false ^
  -o dist 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath build.log"

if exist dist\Sanction.Loader.exe goto ok

echo.
echo [!] Sborka ne udalas'. Polnyj log sohranyon: loader\build.log
echo     Nizhe - veroyatnye prichiny po soderzhimomu loga.
echo.
findstr /c:"NETSDK1045" build.log >nul 2>nul && (
  echo     NETSDK1045 - SDK starshe 8.0. Ustanovite .NET 8 SDK:
  echo                  https://dotnet.microsoft.com/download/dotnet/8.0
)
findstr /r /c:"NU1[0-9][0-9][0-9]" /c:"Unable to find package" /c:"nuget.org" build.log >nul 2>nul && (
  echo     NuGet - self-contained sborka kachaet runtime pack iz nuget.org.
  echo             Nuzhna set' bez blokirovki nuget.org, libo offline-varianty:
  echo                 build.cmd portable   - voobshche bez obrashchenij k NuGet
  echo                 build.cmd small      - tozhe bez runtime pack
  echo             ^(oba dayut ~2 MB exe, no na mashine pol'zovatelya ponadobitsya
  echo               .NET 8 Desktop Runtime^)
)
findstr /r /c:"error CS[0-9][0-9][0-9][0-9]" build.log >nul 2>nul && (
  echo     CS - oshibka kompilyacii v C#. Prishlite loader\build.log celikom.
)
findstr /r /c:"error MSB[0-9]*" build.log >nul 2>nul && (
  echo     MSBuild - chasto iz-za puti s kirillicej/probelami ili zanyatogo faila.
  echo               Zakrojte zapushennyj Sanction.Loader.exe i povtorite.
)
echo.
exit /b 1

:ok
echo.
echo Gotovo
for %%F in (dist\Sanction.Loader.exe) do echo   fajl    loader\dist\Sanction.Loader.exe ^(%%~zF bajt^)
certutil -hashfile dist\Sanction.Loader.exe SHA256 | findstr /v ":" | findstr /v "CertUtil"
echo.
echo Server otdaet etot fajl na /dl/loader.
echo.
endlocal
