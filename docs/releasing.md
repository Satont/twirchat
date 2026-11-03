# Builds and releases

The GPUIX desktop and backend are released together from stable `vX.Y.Z` Git tags.
The first release of this distribution is `v1.0.0`. The tag identifies the exact source
commit; the desktop version and backend image tag use the same version without `v`.

## Pull requests

The `Quality` workflow validates pull requests and pushes to `main`:

- TypeScript, Oxlint, Oxfmt, project quality rules and generated YouTube protocol consistency.
- Bun tests, including the PostgreSQL account fixture in an isolated test container.
- Backend Docker builds for `linux/amd64` and `linux/arm64`.
- Native desktop compilation, runtime checks and Velopack packaging on each supported target.

`Required checks` succeeds only after all prerequisite jobs succeed. Pull-request jobs have
read-only repository access and do not publish packages or use signing credentials.
Desktop checks run the compiled executable's headless release probe from a separate working
directory, including updater loading and packaged runtime assets. They do not demonstrate an
interactive installation or upgrade on a user's desktop.

| Desktop target      | Native build runner | Installer/update channel |
| ------------------- | ------------------- | ------------------------ |
| Linux x64           | Ubuntu 22.04        | `linux-x64`              |
| Windows x64         | Windows 2025        | `win-x64`                |
| macOS Apple Silicon | macOS 15 arm64      | `osx-arm64`              |
| macOS Intel         | macOS 15 Intel      | `osx-x64`                |

Linux builds use Ubuntu 22.04 as the glibc 2.35 baseline. The installed system still needs a
working Vulkan driver and the platform libraries used by GPUI. macOS requires version 13 or
newer. Native compilation runs on the target architecture rather than copying the developer's
native addon. The source revisions, patch checksums and Rust toolchain are pinned in
`packages/desktop/native/gpuix/source.json`; CI caches also distinguish the host OS and architecture.

Resource benchmarks are a separate acceptance workflow described in
[the benchmark guide](benchmarks/README.md). They are not run automatically as part of release
packaging, and release builds do not replace measured performance evidence.

## Create a release

1. Merge a pull request after its required checks pass.
2. Check that the repository `BACKEND_URL` variable identifies the intended public HTTPS backend.
   The current endpoint is `https://chat.twir.app`. The WebSocket URL is derived from this URL.
   OAuth client secrets belong on the backend and are never compiled into the desktop.
3. Create and push a new stable tag on the intended `main` commit:

   ```bash
   git switch main
   git pull --ff-only origin main
   git tag -a v1.0.0 -m 'TwirChat 1.0.0'
   git push origin v1.0.0
   ```

4. Watch the `Release` workflow. It verifies the version/tag and requires the tagged commit to
   belong to `main`, runs validation, and builds all desktop and backend artifacts.
5. Publication happens after the required builds succeed. The publisher creates a draft release,
   uploads the installer packages, update feeds and `SHA256SUMS`, then publishes it. Backend
   images are published at `ghcr.io/satont/twirchat/backend:1.0.0` and `:latest`.

Use the next unused version for later releases. Never move a published version tag to a different
commit. A failed workflow can be retried for the same unchanged tag; investigate the failed job
before publishing anything manually. A draft is not a successful public release. Keep previous
public versions available for user rollback and delta generation.

GitHub publication does not deploy the backend to a running server. Deploy the matching image
with the operational procedure below. For changes requiring a backend capability, deploy a
backward-compatible backend before users install the new desktop.

## Install and update

Download installers from [GitHub Releases](https://github.com/Satont/twirchat/releases).
Choose the architecture-specific asset and verify it against the same release's `SHA256SUMS`:

```bash
# Linux: run in the directory containing the downloaded installer and SHA256SUMS.
sha256sum --check --ignore-missing SHA256SUMS
```

On macOS use `shasum -a 256 <downloaded-file>` and compare the result with `SHA256SUMS`.
On Windows use `Get-FileHash -Algorithm SHA256 <downloaded-file>` in PowerShell. Checksums
detect damaged or mismatched downloads; they are published alongside the files in GitHub.

Linux uses a self-updating AppImage. Windows uses a Velopack Setup installer; portable archives
are also release assets. macOS uses the installer or application archive for the selected CPU.
Preserve the complete application directory when using an archive: the native addon, fonts,
overlay and worker files are runtime dependencies.

Velopack SDK and CLI are both pinned to `1.3.39-g8d2844f`. The package ID remains
`dev.twirchat.app`. Each installed package records its architecture-specific channel, and the
updater reads `releases.<channel>.json` from the public GitHub release. Automatic checks respect
the app setting. Users can download an available update and restart to apply it; development
and unpackaged runs do not use the installed-app updater.

From the second release onward, packaging downloads the previous full package for the same
channel before generating deltas. A previous feed JSON is not release notes and is not enough
to create a delta. Every published feed must refer to package files uploaded to that release.

### Migration from the old distribution

The old release/tag history is being reset for the GPUIX distribution. Previous installers used
the `linux`, `win` and `osx` feeds; the new feeds include CPU architecture. Install the new
architecture-specific package manually once. Existing old clients cannot be assumed to discover
it automatically after their old release/feed is removed. Back up the desktop profile before
reinstalling. The normal production profile is `~/.twirchat`; preserve it to retain local data.

### Signing status

The initial GPUIX installers are unsigned. macOS packages are not notarized. Windows SmartScreen
and macOS Gatekeeper may therefore require additional user action. Release pages and CI logs
must not label these artifacts as signed.

Public signing requires a Windows code-signing certificate or supported signing service, and
Apple Developer ID Application/Installer identities plus notarization credentials for macOS.
Bun also requires the JIT entitlements in `packages/desktop/build/bun.entitlements`. To enable
optional release signing, set the repository variable `RELEASE_SIGNING=true` and configure the
GitHub Actions secrets:

| Platform | Secrets                                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`                                                                                                               |
| macOS    | `MACOS_CERTIFICATES_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGN_APP_IDENTITY`, `MACOS_SIGN_INSTALL_IDENTITY`, `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID` |

The macOS P12 must include both Developer ID identities. Enabling signing requires complete
credential sets; missing credentials fail the release job. With signing disabled, each artifact
includes a `signature-<runtime>.txt` file explicitly recording unsigned output. macOS native files
are signed before their integrity
manifest hashes are refreshed and the application bundle is sealed/notarized. The build checks
the final payload so code signing cannot silently invalidate native runtime verification.
Windows packaging excludes native `.node` addons from signing to preserve their verified hashes.
Do not add certificates or signing passwords to the source tree or release artifacts.

## Deploy the backend

The image contains a compiled Bun executable, runs as an unprivileged user, and exposes `/health`
on port 3000. Builder and runtime image digests are pinned in `packages/backend/Dockerfile`.
The build uses the frozen workspace lockfile. Environment files and build caches are excluded
from the Docker context.

Run production commands from the repository root using `docker-compose.yml`. It publishes the backend to
`127.0.0.1:3000` by default, leaves PostgreSQL private to the Compose network and stores
PostgreSQL 18 data at `/var/lib/postgresql` in a named volume. The project name is `twirchat`
and the default image version is `1.0.0`. `docker/docker-compose.yml` is a compatibility include
of this canonical configuration and requires Docker Compose 2.20 or newer.

1. Copy `.env.production.example` to `.env` in the repository root and fill in every required
   value from `packages/backend/src/config.ts`:

   ```bash
   cp .env.production.example .env
   ```

   - `DATABASE_URL` pointing at `twirchat-postgres:5432`, with URL-encoded credentials.
   - `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, `KICK_WEBHOOK_URL`, `KICK_WEBHOOK_SECRET`.
   - `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`.
   - `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`.

   Set the public OAuth redirect URIs for Kick and Twitch and the optional `YOUTUBE_API_KEY`
   when using the anonymous gRPC relay. Choose a strong `POSTGRES_PASSWORD` in the
   same file; `POSTGRES_USER` and `POSTGRES_DB` default to `twirchat`. `DATABASE_URL` must use
   the same user, database and password. Keep `PORT=3000` inside the container. Set
   `TWIRCHAT_VERSION` to an immutable release version when upgrading. `BACKEND_PORT` and
   `BACKEND_BIND_ADDRESS` change only the host-side binding.

2. Put a reverse proxy with HTTPS in front of the backend and forward WebSocket upgrades on
   `/ws`. OAuth callbacks and Kick webhooks must reach their configured public URLs.
3. Before replacing an existing backend, save the current image digest and take a database backup:

   ```bash
   docker compose images
   docker compose exec -T twirchat-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > twirchat-before-upgrade.dump
   ```

4. Pull the selected version and start it:

   ```bash
   docker compose pull
   docker compose up -d
   docker compose ps
   curl --fail http://127.0.0.1:3000/health
   docker compose logs --tail 100 twirchat-backend
   ```

   On a first deployment, run the pull/start commands before attempting the backup. Backend
   migrations execute automatically on startup. `/health` confirms HTTP responsiveness;
   inspect migration logs and verify OAuth/chat connections before considering rollout complete.

For application rollback, select the previous version or digest and repeat pull/start. A binary
rollback is safe only when that version supports the current database schema. For an incompatible
schema change, restore the saved database backup during a coordinated maintenance window.
Never use `docker compose down --volumes` as an upgrade or rollback step.

If the existing PostgreSQL 18 installation used the old `/var/lib/postgresql/data` mount, back up
and migrate its data before starting this composition; changing the mount path is not a database
upgrade. Keep database backups outside the container volume and test restoration separately.
An older Compose project may also have a differently named volume. Preserve and migrate that
volume explicitly before switching to the stable `twirchat` project name.
