#!/usr/bin/env bash
set -euo pipefail

directory="$(mktemp -d)"
trap 'rm -rf "$directory"' EXIT
verify="$(dirname "$0")/verify-release-assets.sh"
printf 'fixture package\n' > "$directory/package.nupkg"
hash="$(sha256sum "$directory/package.nupkg")"
hash="${hash%% *}"
size="$(stat -c %s "$directory/package.nupkg")"
jq -n --arg hash "$hash" --argjson size "$size" '{Assets: [{
  PackageId: "dev.twirchat.app", Version: "1.0.0", Type: "Full",
  FileName: "package.nupkg", SHA256: $hash, Size: $size
}]}' > "$directory/valid.json"
for runtime in linux-x64 win-x64 osx-arm64 osx-x64; do
  cp "$directory/valid.json" "$directory/releases.$runtime.json"
done
bash "$verify" "$directory" 1.0.0

expect_rejection() {
  if bash "$verify" "$directory" 1.0.0 > /dev/null 2>&1; then
    echo "Invalid release assets were accepted: $1" >&2
    exit 1
  fi
}

printf 'corruption' >> "$directory/package.nupkg"
expect_rejection 'package size changed'
printf 'fixture packagE\n' > "$directory/package.nupkg"
expect_rejection 'package checksum changed without changing size'
printf 'fixture package\n' > "$directory/package.nupkg"
for mutation in \
  '.Assets[0].FileName = "missing.nupkg"' \
  '.Assets[0].Version = "0.9.0"' \
  '.Assets[0].FileName = "../outside.nupkg"' \
  '.Assets += .Assets'; do
  jq "$mutation" "$directory/valid.json" > "$directory/releases.linux-x64.json"
  expect_rejection "$mutation"
done
echo 'Release integrity checks reject missing, corrupted, mismatched and unsafe assets.'

assemble="$(dirname "$0")/assemble-release-assets.sh"
input="$directory/artifacts"
for runtime in linux-x64 win-x64 osx-arm64 osx-x64; do
  mkdir -p "$input/desktop-$runtime"
  cp "$directory/package.nupkg" "$input/desktop-$runtime/package-$runtime.nupkg"
  jq --arg filename "package-$runtime.nupkg" '.Assets[0].FileName = $filename' \
    "$directory/valid.json" > "$input/desktop-$runtime/releases.$runtime.json"
  printf 'Signing: unsigned\n' > "$input/desktop-$runtime/signature-$runtime.txt"
done
bash "$assemble" "$input" "$directory/assembled" 1.0.0
(cd "$directory/assembled" && sha256sum --check --status SHA256SUMS)
expect_assembly_rejection() {
  if bash "$assemble" "$input" "$directory/rejected-$1" 1.0.0 > /dev/null 2>&1; then
    echo "Invalid release assembly was accepted: $1" >&2
    exit 1
  fi
}
printf 'duplicate\n' > "$input/desktop-linux-x64/duplicate.txt"
printf 'duplicate\n' > "$input/desktop-win-x64/duplicate.txt"
expect_assembly_rejection collision
rm "$input/desktop-linux-x64/duplicate.txt" "$input/desktop-win-x64/duplicate.txt"
rm "$input/desktop-linux-x64/signature-linux-x64.txt"
expect_assembly_rejection missing-signature
printf 'Signing: unsigned\n' > "$input/desktop-linux-x64/signature-linux-x64.txt"
printf 'unexpected checksum file\n' > "$input/desktop-linux-x64/SHA256SUMS"
expect_assembly_rejection supplied-checksums
rm "$input/desktop-linux-x64/SHA256SUMS"
printf 'corruption' >> "$input/desktop-linux-x64/package-linux-x64.nupkg"
expect_assembly_rejection corrupt-package
echo 'Release assembly validates all four artifact directories and creates checked SHA256SUMS.'

render_downloads="$(dirname "$0")/render-release-downloads.sh"
downloads="$directory/downloads"
mkdir "$downloads"
for installer in \
  dev.twirchat.app-win-x64-Setup.exe \
  dev.twirchat.app-osx-arm64-Setup.pkg \
  dev.twirchat.app-osx-x64-Setup.pkg \
  dev.twirchat.app-linux-x64.AppImage; do
  printf 'fixture installer\n' > "$downloads/$installer"
done
repository_url=https://github.example.com/example/twirchat
bash "$render_downloads" "$downloads" "$repository_url" v1.0.0 > "$directory/downloads.md"
diff -u - "$directory/downloads.md" <<'EXPECTED'
**Download TwirChat**

| Platform | Download |
| --- | --- |
| Windows (x64) | [Installer (.exe)](https://github.example.com/example/twirchat/releases/download/v1.0.0/dev.twirchat.app-win-x64-Setup.exe) |
| macOS (Apple Silicon) | [Installer (.pkg)](https://github.example.com/example/twirchat/releases/download/v1.0.0/dev.twirchat.app-osx-arm64-Setup.pkg) |
| macOS (Intel) | [Installer (.pkg)](https://github.example.com/example/twirchat/releases/download/v1.0.0/dev.twirchat.app-osx-x64-Setup.pkg) |
| Linux (x64) | [AppImage](https://github.example.com/example/twirchat/releases/download/v1.0.0/dev.twirchat.app-linux-x64.AppImage) |
EXPECTED
rm "$downloads/dev.twirchat.app-osx-x64-Setup.pkg"
if bash "$render_downloads" "$downloads" "$repository_url" v1.0.0 > /dev/null 2>&1; then
  echo 'Release download table accepted a missing installer' >&2
  exit 1
fi
echo 'Release notes link to all four installers and reject missing downloads.'
