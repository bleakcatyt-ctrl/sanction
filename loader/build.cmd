@echo off
REM Sanction Loader — publish script (Windows).
REM
REM   build.cmd                 self-contained single file .exe (end users)
REM   build.cmd small           framework-dependent (~2 MB, needs .NET 8 Desktop Runtime)
REM   build.cmd api https://... re-embed API URL + server key, then publish
REM
REM Output: loader\dist\Sanction.Loader.exe

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "MODE=self-contained"
set "API="

if /i "%~1"=="small" set "MODE=framework-dependent"
if /i "%~1"=="api"    set "API=%~2"

where dotnet >nul 2>nul
if errorlevel 1 (
  echo dotnet SDK ne najden. Ustanovite .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0
  exit /b 1
)

if not "%API%"=="" (
  echo -^> vshivaem adres API i kluch servera: %API%
  pushd ..
  node tools\embed-loader-config.js %API%
  if errorlevel 1 ( popd & exit /b 1 )
  popd
)

set "SELF=true"
if "%MODE%"=="framework-dependent" set "SELF=false"

echo -^> dotnet publish ^(%MODE%, win-x64, single file^)
if exist dist rmdir /s /q dist

dotnet publish Sanction.Loader\Sanction.Loader.csproj ^
  -c Release ^
  -r win-x64 ^
  --self-contained %SELF% ^
  -p:PublishSingleFile=true ^
  -p:IncludeNativeLibrariesForSelfExtract=true ^
  -p:EnableCompressionInSingleFile=true ^
  -p:DebugType=none ^
  -p:DebugSymbols=false ^
  -o dist

if errorlevel 1 (
  echo Sborka zakonchilas' oshibkoj.
  exit /b 1
)

if not exist dist\Sanction.Loader.exe (
  echo Sborka ne najdena: dist\Sanction.Loader.exe
  exit /b 1
)

echo.
echo Gotovo
for %%F in (dist\Sanction.Loader.exe) do echo   fajl    loader\dist\Sanction.Loader.exe ^(%%~zF bajt^)
certutil -hashfile dist\Sanction.Loader.exe SHA256 | findstr /v ":" | findstr /v "CertUtil"
echo.
echo Server otdaet etot fajl na /dl/loader.
echo.
endlocal
