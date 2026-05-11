# TwirChat Desktop Rust

GPUI shell for the native Rust desktop UI.

## Scope

- Native GPUI desktop shell with Rust-side runtime state for settings, overlay serving, update toast state,
  and packaging verification.
- The production packaging truth still comes from `packages/desktop/electrobun.config.ts` until a full
  native release pipeline exists.
- Rust currently has update toast/state parity, not a full native updater pipeline.

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

## Intentional first-pass simplifications

- Full native updater download/apply/relaunch pipeline is not implemented yet.
- Native release packaging still needs an installer/bundle stage; the current Rust layer verifies the
  asset contract expected by that stage.
