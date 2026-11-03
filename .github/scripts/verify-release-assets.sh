#!/usr/bin/env bash
set -euo pipefail

directory="${1:?Release asset directory required}"
version="${2:?Release version required}"

for runtime in linux-x64 win-x64 osx-arm64 osx-x64; do
  feed="$directory/releases.$runtime.json"
  jq -e --arg version "$version" '
    .Assets | type == "array" and length > 0
    and any(.[]; .Version == $version and .Type == "Full")
    and (map(.FileName) | length == (unique | length))
    and all(.[];
      .PackageId == "dev.twirchat.app"
      and (.Version | type == "string")
      and (.Type | IN("Full", "Delta", "Portable", "Installer", "Msi"))
      and (.FileName | type == "string" and test("^[A-Za-z0-9._-]+$") and length < 256)
      and (.SHA256 | type == "string" and test("^[a-fA-F0-9]{64}$"))
      and (.Size | type == "number" and . > 0 and floor == .))
  ' "$feed" > /dev/null
  while IFS=$'\t' read -r filename expected_hash expected_size; do
    file="$directory/$filename"
    test -f "$file"
    test "$(stat -c %s "$file")" = "$expected_size"
    actual_hash="$(sha256sum -- "$file")"
    test "${actual_hash%% *}" = "${expected_hash,,}"
  done < <(jq -r '.Assets[] | [.FileName, .SHA256, .Size] | @tsv' "$feed")
done
