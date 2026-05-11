# Updater stabilization status

## Current Rust parity

The Rust desktop runtime currently mirrors the user-visible updater state machine used by the existing
desktop UI:

- update toast visibility and payload snapshots
- check/download/apply/skip commands
- download progress family statuses
- skipped-hash suppression for already skipped updates
- serialized update status payloads for UI/service boundaries

This is state/toast parity only. The native Rust desktop does not yet own a complete updater pipeline
that checks GitHub releases, downloads artifacts, validates signatures or hashes, applies an update,
replaces the running app, and relaunches.

## Packaging stabilization added in Task 25

`src/runtime/packaging.rs` records the package asset contract that a future native updater/installer must
preserve. It intentionally mirrors `packages/desktop/electrobun.config.ts`:

- overlay HTML and bundled assets are required at `views/overlay/`
- main-window HTML and bundled assets are required at `views/main/`
- font assets are required at `views/fonts/`
- Linux, Windows, and macOS icon assets remain required under `assets/`
- app identity stays aligned with `TwirChat` / `dev.twirchat.app`
- release download assumptions stay aligned with the existing GitHub release base URL

The packaging tests produce evidence files for both the passing artifact contract and the expected
failure mode when a required overlay asset is absent.

## Remaining stabilization checklist

- Define the native Rust package layout and installer targets per OS.
- Decide whether the Rust package consumes the existing Vite-built `packages/desktop/dist` assets or
  moves those assets behind a shared build step.
- Add native release artifact generation and checksums/signatures.
- Implement release discovery against the GitHub release channel.
- Implement download, resume/retry, integrity validation, and local cache handling.
- Implement safe apply/relaunch behavior for Linux, Windows, and macOS.
- Wire updater commands to the native service implementation instead of state-only transitions.
- Add end-to-end updater tests against fixture release manifests/artifacts.
- Keep the packaging verifier in CI so missing overlay, font, or icon assets fail before release.
