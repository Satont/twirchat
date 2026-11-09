#!/usr/bin/env bash
set -euo pipefail

REPO='Satont/twirchat'
APP_ID='dev.twirchat.app'

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This installer supports Linux x64 only.' >&2
  exit 1
fi

for dependency in curl jq sha256sum install; do
  if ! command -v "$dependency" > /dev/null; then
    echo "Install $dependency before running this installer." >&2
    exit 1
  fi
done

echo 'Fetching the latest stable release from GitHub...'
release_json=$(curl --fail --silent --show-error --location "https://api.github.com/repos/$REPO/releases/latest")
version=$(jq --exit-status --raw-output '.tag_name | select(test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))' <<< "$release_json")
appimage_url=$(jq --exit-status --raw-output '
  [.assets[] | select(.name | test("linux-x64.*\\.AppImage$")) | .browser_download_url]
  | select(length == 1) | .[0]
' <<< "$release_json")
checksums_url=$(jq --exit-status --raw-output '
  [.assets[] | select(.name == "SHA256SUMS") | .browser_download_url]
  | select(length == 1) | .[0]
' <<< "$release_json")

download_prefix="https://github.com/$REPO/releases/download/$version/"
if [[ "$appimage_url" != "$download_prefix"* || "$checksums_url" != "${download_prefix}SHA256SUMS" ]]; then
  echo 'The release has unexpected download URLs.' >&2
  exit 1
fi
appimage_filename=${appimage_url##*/}
if [[ ! "$appimage_filename" =~ ^[a-zA-Z0-9._+-]+\.AppImage$ ]]; then
  echo 'The release has an invalid AppImage filename.' >&2
  exit 1
fi

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
echo "Downloading TwirChat $version (Linux x64)..."
curl --fail --silent --show-error --location "$appimage_url" --output "$temporary/$appimage_filename"
curl --fail --silent --show-error --location "$checksums_url" --output "$temporary/SHA256SUMS"
awk -v filename="$appimage_filename" '$2 == filename || $2 == "*" filename { print }' \
  "$temporary/SHA256SUMS" > "$temporary/installer.sha256"
if [[ $(wc -l < "$temporary/installer.sha256") -ne 1 ]]; then
  echo 'The release must contain exactly one checksum for its AppImage.' >&2
  exit 1
fi
(cd "$temporary" && sha256sum --check --strict installer.sha256)

install_dir="$HOME/.local/share/$APP_ID"
app_path="$install_dir/TwirChat.AppImage"
mkdir -p "$install_dir" "$HOME/.local/bin" "$HOME/.local/share/applications"
install -m 755 "$temporary/$appimage_filename" "$install_dir/.TwirChat.AppImage.new"
mv -f "$install_dir/.TwirChat.AppImage.new" "$app_path"

icon_path='twirchat'
if [[ -f "$install_dir/icon.png" ]]; then
  icon_path="$install_dir/icon.png"
fi
if (cd "$temporary" && "$app_path" --appimage-extract '*.png' > /dev/null 2>&1) && [[ -d "$temporary/squashfs-root" ]]; then
  icon_source=$(find "$temporary/squashfs-root" -type f -name '*.png' -print -quit)
  if [[ -n "$icon_source" ]]; then
    install -m 644 "$icon_source" "$install_dir/icon.png"
    icon_path="$install_dir/icon.png"
  fi
fi

cat > "$HOME/.local/share/applications/$APP_ID.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=TwirChat
Comment=Multi-platform chat manager for streamers
Exec="$app_path" %u
Icon=$icon_path
Terminal=false
StartupWMClass=$APP_ID
Categories=Network;InstantMessaging;
EOF

legacy_desktop="$HOME/.local/share/applications/twirchat.desktop"
if [[ -f "$legacy_desktop" && ! -L "$legacy_desktop" ]] \
  && grep -Fxq "Exec=\"$app_path\" %u" "$legacy_desktop" \
  && grep -Fxq 'Name=TwirChat' "$legacy_desktop" \
  && grep -Fxq 'StartupWMClass=TwirChat' "$legacy_desktop"; then
  rm "$legacy_desktop"
fi

ln -sf "$app_path" "$HOME/.local/bin/twirchat"
if command -v update-desktop-database > /dev/null; then
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi
echo "TwirChat $version installed at $app_path. Launch it from the application menu or run twirchat."
