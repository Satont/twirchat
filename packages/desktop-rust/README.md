# TwirChat Desktop Rust

GPUI shell for the native Rust desktop UI.

## Scope

- Native GPUI desktop shell with Rust-side runtime state for settings, overlay serving, update toast state,
  and packaging verification.
- Production desktop releases are published from `packages/desktop-rust` through the Velopack release
  contract in `src/runtime/packaging.rs`.
- The Rust runtime initializes Velopack at startup and performs safe update checks for packaged builds;
  download/apply/relaunch behavior remains outside the current release contract.

## Run

```sh
cargo run --manifest-path packages/desktop-rust/Cargo.toml
```

## Verify

```sh
cargo fmt --manifest-path packages/desktop-rust/Cargo.toml
cargo check --manifest-path packages/desktop-rust/Cargo.toml
cargo test --manifest-path packages/desktop-rust/Cargo.toml
```

Strict verification before packaging handoff:

```sh
cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check
cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features
```

## Package asset verification

The Rust package verifier mirrors the current Electrobun packaging contract instead of inventing a
second source of truth:

- `dist/overlay/index.html` -> `views/overlay/index.html`
- `dist/overlay/assets` -> `views/overlay/assets`
- `dist/main/index.html` -> `views/main/index.html`
- `dist/main/assets` -> `views/main/assets`
- `public/fonts` -> `views/fonts`
- `assets/icon.png`, `assets/icon.ico`, and `assets/icon.iconset` remain required platform icon assets
- App metadata remains `TwirChat`, `dev.twirchat.app`, and the GitHub release download base URL used
  by the existing desktop package

Run the focused verifier tests with:

```sh
cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_artifact_contains_required_assets -- --nocapture
cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_missing_overlay_asset_fails -- --nocapture
```

From the repo root, the same flow is exposed as:

```sh
bun run package:desktop-rust:verify
```

The tests write evidence to `.sisyphus/evidence/task-25-packaging-assets.json` and
`.sisyphus/evidence/task-25-packaging-error.json`.

## Velopack release contract

The native Rust Velopack release contract is deterministic and lives in
`src/runtime/packaging.rs`:

- Package ID is `dev.twirchat.app`, matching the preserved `TwirChat` app metadata from the
  Electrobun desktop package and Rust packaging verifier.
- Stable release tags only match `^v[0-9]+\.[0-9]+\.[0-9]+$`.
- `packVersion` strips the leading `v` from a stable tag, so `v1.2.3` becomes `1.2.3`.
- Platform channels are `linux`, `win`, and `osx`.
- Architecture matrix is Linux x64, Windows x64, and macOS universal.
- The first stable tag creates the initial Velopack feed for every platform channel.
- Rerunning an already-published stable tag must fail rather than overwrite release assets or feeds.
- Signing and notarization are not part of the current contract.
- Prerelease channels are not supported; beta, nightly, prerelease, and unprefixed semver tags are
  rejected.

Print or validate the executable contract with:

```sh
cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin release-contract -- v1.2.3
```

Invalid tags fail with a non-zero exit code:

```sh
cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin release-contract -- v1.2.3-beta.1
cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin release-contract -- 1.2.3
```

## Current updater boundaries

- Startup initialization and update-feed checks are implemented in `src/runtime/update.rs` and are safe
  no-ops for dev, unpackaged, offline, and no-feed states.
- The current contract publishes stable Velopack packages and feeds; in-app download, apply, and
  relaunch actions are not part of this release pass.
