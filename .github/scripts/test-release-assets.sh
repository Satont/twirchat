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
