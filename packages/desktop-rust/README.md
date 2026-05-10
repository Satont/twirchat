# TwirChat Desktop Rust

First-pass GPUI shell for the desktop UI.

## Scope

- Visual desktop shell only
- Mock data only
- No backend, RPC, auth, persistence, or overlay integration yet
- Raw GPUI primitives only

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

## Intentional first-pass simplifications

- Static visual composer instead of full text input
- Letter glyphs instead of imported SVG platform icons
- Fixed-height virtualized chat rows via `uniform_list`
- No split layout, drag/drop, modals, or popovers yet
