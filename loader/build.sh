#!/usr/bin/env bash
#
# Sanction Loader — publish script (Linux / macOS / Windows-bash).
#
#   ./build.sh            self-contained single file .exe  (end users, no runtime needed)
#   ./build.sh --small    framework-dependent single file  (~2 MB, needs .NET 8 Desktop Runtime)
#   ./build.sh --portable framework-dependent, no RID: zero NuGet downloads
#                         (use when nuget.org is blocked; needs .NET 8 Desktop Runtime)
#   ./build.sh --api https://api.example.com
#                         re-embeds the API URL + server key first (npm run loader:config)
#
# Output: loader/dist/Sanction.Loader.exe — the exact path config.build.artifactPath
# serves from /dl/loader, so the site starts offering downloads right away.

set -euo pipefail

# $0 is usually relative and the script changes directory, so resolve it once
# here; otherwise --help tries to read a path that no longer exists.
SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT")"
ROOT="$(cd .. && pwd)"
PROJECT="Sanction.Loader/Sanction.Loader.csproj"
OUT="dist"
MODE="self-contained"
API=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --small) MODE="framework-dependent"; shift ;;
    --portable) MODE="portable"; shift ;;
    --api) API="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$SCRIPT"; exit 0 ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
done

if ! command -v dotnet >/dev/null 2>&1; then
  echo "dotnet SDK не найден. Установите .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0" >&2
  exit 1
fi

if [[ -n "$API" ]]; then
  echo "→ вшиваем адрес API и ключ сервера: $API"
  (cd "$ROOT" && node tools/embed-loader-config.js "$API")
fi

SELF="true"
RID=(-r win-x64)
if [[ "$MODE" == "framework-dependent" ]]; then SELF="false"; fi
if [[ "$MODE" == "portable" ]]; then
  # No RID: the publish downloads nothing from NuGet. The resulting exe needs
  # the .NET 8 Desktop Runtime on the machine that runs it.
  SELF="false"
  RID=()
fi

echo "→ dotnet publish ($MODE, single file)"
rm -rf "$OUT"

# EnableWindowsTargeting lets a Linux/macOS host build the Windows exe.
dotnet publish "$PROJECT" \
  -c Release \
  ${RID[@]+"${RID[@]}"} \
  --self-contained "$SELF" \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:EnableCompressionInSingleFile=true \
  -p:EnableWindowsTargeting=true \
  -p:DebugType=none \
  -p:DebugSymbols=false \
  -p:SatelliteResourceLanguages=en \
  -o "$OUT"

EXE="$OUT/Sanction.Loader.exe"
if [[ ! -f "$EXE" ]]; then
  echo "Сборка не найдена: $EXE" >&2
  exit 1
fi

SIZE=$(du -h "$EXE" | cut -f1 | tr -d ' ')
SHA=$(sha256sum "$EXE" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$EXE" | cut -d' ' -f1)

echo ""
echo "Готово"
echo "  файл    loader/$EXE ($SIZE)"
echo "  sha256  $SHA"
echo ""
echo "Сервер отдаёт этот файл на /dl/loader (LOADER_ARTIFACT по умолчанию)."
echo "Чтобы зафиксировать версию в админке:"
echo "  LOADER_SHA256=$SHA npm start"
echo ""
