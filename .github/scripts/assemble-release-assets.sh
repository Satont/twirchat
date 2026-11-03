#!/usr/bin/env bash
set -euo pipefail

input="$(realpath -- "${1:?Input artifact directory required}")"
output="$(realpath -m -- "${2:?Output asset directory required}")"
version="${3:?Release version required}"
test -d "$input"
case "$output" in
  "$input" | "$input"/*)
    echo 'Output directory must be outside the input artifact directory' >&2
    exit 1
    ;;
esac
mkdir -p "$(dirname "$output")"
mkdir "$output"
while IFS= read -r -d '' asset; do
  name="$(basename "$asset")"
  destination="$output/$name"
  test "$name" != SHA256SUMS || { echo 'Input artifacts must not supply SHA256SUMS' >&2; exit 1; }
  test ! -e "$destination" || { echo "Duplicate release asset: $name" >&2; exit 1; }
  cp -- "$asset" "$destination"
done < <(find "$input" -type f -print0)
for runtime in linux-x64 win-x64 osx-arm64 osx-x64; do
  test -s "$output/releases.$runtime.json"
  test -s "$output/signature-$runtime.txt"
done
bash "$(dirname "$0")/verify-release-assets.sh" "$output" "$version"
checksums="$(mktemp)"
(cd "$output" && sha256sum -- *) > "$checksums"
mv -- "$checksums" "$output/SHA256SUMS"
