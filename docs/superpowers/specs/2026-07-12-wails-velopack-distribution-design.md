# Wails Velopack Distribution Design

## Goal

Replace the Rust/GPUI release build with a Wails/Go release while preserving the
existing Velopack update contract so installed Rust applications migrate through
their current updater feed.

## Compatibility Contract

- Package identity remains `dev.twirchat.app`.
- Stable tags only: `vX.Y.Z`.
- Existing channels remain `linux`, `win`, and `osx`.
- Existing GitHub Release feeds remain `releases.linux.json`,
  `releases.win.json`, and `releases.osx.json`.
- The first Wails release merges new package assets into the existing feeds using
  `vpk upload github --publish --merge`.
- Rust source compatibility is intentionally not retained. Installed Rust apps
  retain updater compatibility only through the unchanged Velopack identity,
  channel and feed contract.

## Runtime Updater

- Add `github.com/quaadgras/velopack-go/velopack` to the Wails application.
- Call `velopack.Run` before Wails startup with `AutoApplyOnStartup: true`.
- Re-enable the existing Vue updater UI through Go bridge handlers for check,
  download, apply and skip; publish progress via Wails events.
- The default update URL is the same GitHub Release `latest/download` channel
  feed used by the Rust client.

## Versioning

- Declare `var version = "dev"` in Go `main`.
- CI builds use `-ldflags="-s -w -X main.version=<tag-without-v>"`.
- Development builds retain `dev`.
- Build verification runs the executable metadata/version probe before Velopack
  packaging and records the version in release artifacts.

## CI Release Pipeline

- Replace Rust build jobs and Rust packaging verifier with Wails/Go jobs.
- Build on native GitHub runners:
  - Linux x64: Wails binary, UPX compression, Velopack Linux package.
  - Windows x64: Wails binary, UPX compression, Velopack Windows Setup package.
  - macOS universal: Wails universal app bundle, no UPX, Velopack macOS package.
- Each platform downloads the previous feed before `vpk pack`, then merges the
  generated assets into the release with the existing channel name.
- Keep the existing backend binary and Docker publication jobs unchanged.
- The release workflow validates package identity, channel, main executable,
  embedded Vue asset presence, injected version and generated feed asset before
  upload.

## UPX

- Install UPX in Linux and Windows CI jobs and run `upx --best --lzma` after
  Wails build and before `vpk pack`.
- Validate the compressed binary with `upx -t` and a short `--version` probe.
- Do not compress macOS bundles in this release; code signing/notarization is
  out of scope and UPX adds platform-launch risk without enough distribution
  benefit.

## Verification

- Go tests cover updater wrapper behavior with an injected Velopack manager.
- CI validates release tag format, injected version, each package layout and
  package/feed identity.
- A manual migration check installs the latest Rust release and updates it from
  the first Wails release through the matching platform channel.
