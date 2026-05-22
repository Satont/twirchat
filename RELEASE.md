# TwirChat Release Configuration

This document describes the automated release pipeline for TwirChat.

## Overview

The release pipeline is fully automated via GitHub Actions and triggers on:

- Pushing a version tag (e.g., `v1.0.0`)
- Manual workflow dispatch with a version input

## What Gets Released

### Desktop Application

- **Linux**: x64 AppImage (Velopack)
- **macOS**: Universal .zip (Velopack)
- **Windows**: x64 Setup .exe (Velopack)

### Backend

- Compiled binary for Linux x64
- Docker image (published to GitHub Container Registry)

## Release Features

### Automatic Changelog

- Generated using conventional commits
- Categorized by commit types (features, fixes, etc.)
- Included in GitHub Release notes

### Environment Configuration

Production builds use environment variables from GitHub Secrets:

- `BACKEND_URL` - Backend HTTP URL
- `BACKEND_WS_URL` - Backend WebSocket URL

## How to Create a Release

### Method 1: Push a Tag (Recommended)

```bash
# Create and push a new version tag
git tag v1.0.0
git push origin v1.0.0
```

The workflow will automatically:

1. Generate changelog from commits
2. Build desktop-rust apps for Linux, Windows, and macOS
3. Create GitHub Release for backend and initial release metadata
4. Publish Velopack packages for each desktop channel (linux, win, osx)
5. Build backend binary and Docker image

### Method 2: Manual Trigger

1. Go to GitHub Actions → Release workflow
2. Click "Run workflow"
3. Enter version (e.g., `v1.0.0`)
4. Click "Run workflow"

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Required variables for production:

- `CHATRIX_BACKEND_URL` - Backend HTTP endpoint
- `CHATRIX_BACKEND_WS_URL` - Backend WebSocket endpoint

Optional variables:

- `AUTH_SERVER_PORT` - Local auth callback port (default: 45821)
- `OVERLAY_SERVER_PORT` - Overlay server port (default: 45823)
- `DB_PATH` - SQLite database path

## Docker Deployment

### Simple (without reverse proxy)

```bash
docker pull ghcr.io/YOUR_USERNAME/twirchat/backend:latest

docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  ghcr.io/YOUR_USERNAME/twirchat/backend:latest
```

### Production (with Caddy)

For production with SSL/TLS and domain:

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/twirchat.git
cd twirchat

# Update Caddyfile.prod with your domain
# Edit: chat.twir.app -> your-domain.com

# Start services
cd docker
docker compose up -d
```

Caddy will automatically:

- Obtain Let's Encrypt certificates
- Handle HTTP → HTTPS redirect
- Proxy WebSocket connections
- Enable HTTP/2 and HTTP/3
- Compress responses with gzip/zstd

## Local Build

### Desktop (Native Rust)

```bash
cd packages/desktop-rust

# Development
cargo run

# Production build
cargo build --release

# Verify packaging assets
cargo test packaging_artifact_contains_required_assets
```

### Backend

```bash
cd packages/backend

# Development
bun run dev

# Compile to binary
bun run build:prod

# Docker build
docker build -t twirchat-backend .
```

## Desktop Updates (Velopack)

The desktop application uses Velopack for distribution and automatic updates:

- **Self-contained**: Desktop artifacts are bundled with all required views and assets.
- **Automatic Updates**: The app checks for updates on startup using the Velopack feed.
- **Stable Only**: Only stable version tags (vX.Y.Z) trigger a full Velopack release. Prerelease, beta, and nightly tags are currently out of scope and rejected by the release contract.
- **No Signing**: Current releases are unsigned and do not include Apple notarization or Windows code signing.
- **Channels**: Stable updates are provided through `linux`, `win`, and `osx` feeds.

## Troubleshooting

### Build Failures

1. Check that all secrets are set in GitHub repository settings
2. Ensure `bun.lock` is committed and up to date
3. Verify all dependencies are properly declared in package.json

### Missing Artifacts

If artifacts are missing from the release:

1. Check the workflow logs for specific platform failures
2. Verify the artifact upload step completed successfully
3. Check artifact retention settings (default: 90 days)

### Docker Push Failures

Ensure the GitHub token has proper permissions:

- Go to Settings → Actions → General
- Enable "Read and write permissions" for workflows
