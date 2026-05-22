# Updater stabilization status

## Current Rust parity

The Rust desktop runtime currently mirrors the user-visible updater state machine used by the existing
desktop UI:

- update toast visibility and payload snapshots
- check/download/apply/skip commands
- download progress family statuses
- skipped-hash suppression for already skipped updates
- serialized update status payloads for UI/service boundaries

The native Rust desktop now initializes Velopack during startup and can check configured Velopack feeds
for packaged builds. Download, apply, replace, and relaunch actions remain outside the current release
contract.

## Packaging stabilization added in Task 25

`src/runtime/packaging.rs` records the package asset contract that the native Velopack release path must
preserve. It keeps the existing Vite-built desktop assets as package inputs:

- overlay HTML and bundled assets are required at `views/overlay/`
- main-window HTML and bundled assets are required at `views/main/`
- font assets are required at `views/fonts/`
- Linux, Windows, and macOS icon assets remain required under `assets/`
- app identity stays aligned with `TwirChat` / `dev.twirchat.app`
- Velopack release identity stays `dev.twirchat.app`

The packaging tests produce evidence files for both the passing artifact contract and the expected
failure mode when a required overlay asset is absent.

## Remaining updater stabilization checklist

- Implement download, resume/retry, integrity validation, and local cache handling.
- Implement safe apply/relaunch behavior for Linux, Windows, and macOS.
- Wire updater commands to the native service implementation instead of state-only transitions.
- Add end-to-end updater tests against fixture release manifests/artifacts.
- Keep the packaging verifier in CI so missing overlay, font, or icon assets fail before release.
