#!/usr/bin/env bash
set -euo pipefail

directory="${1:?Release asset directory required}"
repository_url="${2:?Repository URL required}"
tag="${3:?Release tag required}"
download_url="${repository_url}/releases/download/${tag}"

printf '**Download TwirChat**\n\n| Platform | Download |\n| --- | --- |\n'
while IFS='|' read -r platform label filename; do
  asset="$directory/$filename"
  if [[ ! -f "$asset" || ! -s "$asset" ]]; then
    printf 'Missing or empty release download: %s\n' "$filename" >&2
    exit 1
  fi
  printf '| %s | [%s](%s/%s) |\n' "$platform" "$label" "$download_url" "$filename"
done <<'DOWNLOADS'
Windows (x64)|Installer (.exe)|dev.twirchat.app-win-x64-Setup.exe
macOS (Apple Silicon)|Installer (.pkg)|dev.twirchat.app-osx-arm64-Setup.pkg
macOS (Intel)|Installer (.pkg)|dev.twirchat.app-osx-x64-Setup.pkg
Linux (x64)|AppImage|dev.twirchat.app-linux-x64.AppImage
DOWNLOADS
