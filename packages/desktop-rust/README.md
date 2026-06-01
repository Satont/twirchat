# TwirChat Desktop

GPUI shell for the native TwirChat desktop app. The Cargo package and primary app binary are `twirchat`; helper binaries such as `release-contract` keep their task-specific names.

## Scope

- Native GPUI desktop shell with Rust-side runtime state for settings, overlay serving, update toast
  state, and packaging verification.
- Production desktop releases are published from `packages/desktop-rust` through the Velopack release
  contract in `src/runtime/packaging.rs`.
- The native runtime initializes Velopack at startup, checks stable platform feeds on startup and
  periodically, shows an in-app update toast, downloads updates, and restarts to apply them in
  packaged builds.

## Run

```sh
cargo run --manifest-path packages/desktop-rust/Cargo.toml
cargo build --manifest-path packages/desktop-rust/Cargo.toml --bin twirchat
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

The native package verifier checks only the platform-native artifact staged in Velopack `packDir`:

- Linux target `linux-x64` requires `twirchat`
- Windows target `win-x64` requires `twirchat.exe`
- macOS target `macos-universal` requires `TwirChat.app`, `TwirChat.app/Contents/MacOS/TwirChat`, `TwirChat.app/Contents/Info.plist`, and non-empty `TwirChat.app/Contents/Resources`
- App metadata remains `TwirChat`, `dev.twirchat.app`, and the GitHub release download base URL used
  by the native updater.

Run the focused verifier tests with:

```sh
cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_artifact_contains_required_assets -- --nocapture
cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_missing_native_executable_fails -- --nocapture
```

Verify a prepared CI-style app directory directly with:

```sh
cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin release-contract -- \
  verify-artifact artifacts/desktop-linux-x64 --target linux-x64
```

From the repo root, the same focused test flow is exposed as:

```sh
bun run package:desktop:verify
```

The tests write evidence to `.sisyphus/evidence/task-25-packaging-assets.json` and
`.sisyphus/evidence/task-25-packaging-error.json`.

## Velopack release contract

The native Rust Velopack release contract is deterministic and lives in
`src/runtime/packaging.rs`:

- Package ID is `dev.twirchat.app`, matching the preserved `TwirChat` app metadata from the desktop
  package and native packaging verifier.
- Stable release tags only match `^v[0-9]+\.[0-9]+\.[0-9]+$`.
- `packVersion` strips the leading `v` from a stable tag, so `v1.2.3` becomes `1.2.3`.
- Platform channels are `linux`, `win`, and `osx`.
- Architecture matrix is Linux x64, Windows x64, and macOS universal.
- Linux releases produce Velopack AppImage assets.
- Windows releases produce Velopack Setup `.exe` assets.
- macOS releases produce Velopack `.pkg` assets containing `TwirChat.app`.
- Platform feeds are published as `releases.linux.json`, `releases.win.json`, and
  `releases.osx.json`.
- The first stable tag creates the initial Velopack feed for every platform channel.
- Rerunning an already-published stable tag must fail rather than overwrite release assets or feeds.
- Signing and notarization are not part of the current contract; releases are unsigned and macOS is
  not notarized.
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

## Current updater behavior

- Packaged builds initialize Velopack at startup and use
  `https://github.com/Satont/twirchat/releases/latest/download/releases.<channel>.json` for the
  current platform channel.
- Startup checks and periodic checks run while automatic update checks are enabled.
- Available stable updates are surfaced through the in-app update toast.
- Download and restart/apply actions are wired to Velopack for packaged builds, with safe no-op or
  error states for dev, unpackaged, offline, and missing-feed states.
