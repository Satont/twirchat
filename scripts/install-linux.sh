#!/bin/bash
set -e

REPO="Satont/twirchat"
APP_ID="dev.twirchat.app"
BIN_NAME="twirchat"

echo "Fetching latest release information from GitHub..."
LATEST_RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
VERSION=$(echo "$LATEST_RELEASE_JSON" | grep -oP '"tag_name":\s*"\K[^"]+')

if [ -z "$VERSION" ]; then
    echo "Error: Could not detect latest version."
    exit 1
fi

echo "Latest stable version: $VERSION"

APPIMAGE_URL=$(echo "$LATEST_RELEASE_JSON" | grep -oP '"browser_download_url":\s*"\K[^"]+\.AppImage' | head -n 1)

if [ -z "$APPIMAGE_URL" ]; then
    echo "Error: Could not find an AppImage asset for version $VERSION."
    echo "Please check the releases page: https://github.com/$REPO/releases/latest"
    exit 1
fi

APPIMAGE_FILENAME=$(basename "$APPIMAGE_URL")
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading $APPIMAGE_FILENAME..."
curl -fsSL "$APPIMAGE_URL" -o "$TMP_DIR/TwirChat.AppImage"

INSTALL_DIR="$HOME/.local/share/$APP_ID"
BIN_DIR="$HOME/.local/bin"
APP_PATH="$INSTALL_DIR/TwirChat.AppImage"

echo "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
mv "$TMP_DIR/TwirChat.AppImage" "$APP_PATH"
chmod +x "$APP_PATH"

echo "Extracting application icon..."
cd "$INSTALL_DIR"
"$APP_PATH" --appimage-extract "usr/share/icons/hicolor/512x512/apps/twirchat.png" > /dev/null 2>&1 || \
"$APP_PATH" --appimage-extract "assets/icon.png" > /dev/null 2>&1 || true

if [ -d "squashfs-root" ]; then
    ICON_SOURCE=$(find squashfs-root -name "*.png" | head -n 1)
    if [ -n "$ICON_SOURCE" ]; then
        mv "$ICON_SOURCE" "$INSTALL_DIR/icon.png"
    fi
    rm -rf "squashfs-root"
    ICON_PATH="$INSTALL_DIR/icon.png"
else
    ICON_PATH=""
fi

APPLICATIONS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPLICATIONS_DIR"

cat > "$APPLICATIONS_DIR/twirchat.desktop" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=TwirChat
Comment=Multi-platform chat manager for streamers
Exec="$APP_PATH" %u
Icon=${ICON_PATH:-twirchat}
Terminal=false
StartupWMClass=TwirChat
Categories=Network;InstantMessaging;
EOF

chmod +x "$APPLICATIONS_DIR/twirchat.desktop"
echo "Added TwirChat to the applications menu."

mkdir -p "$BIN_DIR"
ln -sf "$APP_PATH" "$BIN_DIR/$BIN_NAME"
echo "Created symlink: $BIN_NAME -> $APP_PATH"

if command -v update-desktop-database &> /dev/null; then
  update-desktop-database "$APPLICATIONS_DIR" 2>/dev/null || true
fi

echo "TwirChat $VERSION installed successfully!"
echo "You can launch it from your application menu or by running '$BIN_NAME' in your terminal."
