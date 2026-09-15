# TwirChat Release Configuration

This document describes the automated release pipeline for TwirChat.

## Overview

The release pipeline is fully automated via GitHub Actions and triggers on:

- Pushing a version tag (e.g., `v1.0.0`)
- Manual workflow dispatch with a version input

## What Gets Released

### Desktop Application

- **Linux**: x64 AppImage (Velopack)
- **Windows**: x64 Setup `.exe` (Velopack)
- **macOS**: Apple Silicon `.pkg` containing `TwirChat.app` (Velopack; `bun --compile` cannot
  produce universal binaries, so the `osx` feed is arm64-only)

Velopack also publishes platform feeds named `releases.linux.json`, `releases.win.json`, and
`releases.osx.json` to the GitHub Release.

### Backend

- Compiled binary for Linux x64
- Docker image (published to GitHub Container Registry)

## Release Features

### Automatic Changelog

- Generated using conventional commits
- Categorized by commit types (features, fixes, etc.)
- Included in GitHub Release notes

### Environment Configuration

Production desktop builds bake `BACKEND_URL` into the binary via `bun build --compile --define`
(from the `BACKEND_URL` GitHub Actions variable/secret); the backend Docker image is configured
through its own environment.

## How to Create a Release

### Method 1: Push a Tag (Recommended)

```bash
# Create and push a new version tag
git tag v1.0.0
git push origin v1.0.0
```

The workflow will automatically:

1. Generate changelog from commits
2. Build the Bun/GPUIX desktop app (`bun build --compile`) for Linux, Windows, and macOS
3. Create the GitHub Release for backend and release metadata
4. Publish Velopack packages for each desktop channel (`linux`, `win`, `osx`)
5. Build backend binary and Docker image

### Method 2: Manual Trigger

1. Go to GitHub Actions -> Release workflow
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
- Handle HTTP -> HTTPS redirect
- Proxy WebSocket connections
- Enable HTTP/2 and HTTP/3
- Compress responses with gzip/zstd

## Local Build

### Desktop (Bun + GPUIX)

```bash
cd packages/desktop

# Development
bun run dev

# Production binary (VERSION/BACKEND_URL baked via --define)
bun run build:overlay
bun build --compile src/gpuix/main.tsx --outfile dist/twirchat \
  --define '__APP_VERSION__="dev"' \
  --define '__BACKEND_URL__="http://127.0.0.1:3000"'
```

The compiled binary embeds the app code and native modules; the OBS overlay assets
(`dist/overlay`) and fonts (`public/fonts`) are served from disk and must be shipped next to
the executable (the release workflow does this).

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

- **Self-contained**: desktop artifacts are the compiled Bun binary plus on-disk assets
  (`overlay/`, `fonts/`), wrapped into a `TwirChat.app` bundle on macOS, before `vpk pack`.
- **Automatic checks**: packaged builds initialize Velopack at startup and check for updates on
  startup and periodically while automatic update checks are enabled.
- **In-app flow**: available updates appear as an in-app toast; users can download the update and
  restart to apply it through Velopack.
- **Stable only**: only stable version tags (`vX.Y.Z`) trigger a full Velopack release. Prerelease,
  beta, nightly, and unprefixed semver tags are rejected by the release contract.
- **Platform feeds**: stable updates are provided through `releases.linux.json`,
  `releases.win.json`, and `releases.osx.json`.
- **No signing**: current releases are unsigned and do not include Apple notarization or Windows code
  signing.

## Troubleshooting

### Build Failures

1. Check that all secrets are set in GitHub repository settings
2. Ensure `bun.lock` is committed and up to date
3. Verify all dependencies are properly declared in package.json

### Missing Artifacts

If artifacts are missing from the release:

1. Check the workflow logs for platform failures and packaging verifier output
2. Verify the desktop-rust app artifact upload step completed successfully
3. Check artifact retention settings (default: 90 days)

### Docker Push Failures

Ensure the GitHub token has proper permissions:

- Go to Settings -> Actions -> General
- Enable "Read and write permissions" for workflows
