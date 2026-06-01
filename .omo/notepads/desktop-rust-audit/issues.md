# Issues

## 2026-05-31T17:27:40+03:00 - Baseline verification failures

- `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` failed (exit `1`) with formatting diffs under:
  - `packages/desktop-rust/src/app_state/mod.rs`
  - `packages/desktop-rust/src/ui/shell/app.rs`
- `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` failed (exit `101`) with:
  - failing test: `home_emote_sources_include_all_connected_platforms`
  - location: `tests/app_state.rs:81:5`
  - assertion expects Kick 7TV source channel id `kick-7tv` to be present.

## 2026-05-31 - Task 6 residual scope notes

- Full working tree contains modified files outside Task 6 ownership (`app_state`, `overlay`, `storage`, `ui`, and related tests), likely from baseline formatting or parallel tasks. Task 6 verification and diff review were limited to platform/protocol/auth/backend_ws owned paths plus the new evidence/notepad entries.

## 2026-05-31T17:49:16+03:00 - Task 3 verification blocked by parallel unowned edits

- `cargo test --manifest-path packages/desktop-rust/Cargo.toml storage -- --nocapture` failed before running storage assertions because unowned `src/services/backend_ws.rs` test code requires `backend_ws::Frame: Debug` for `expect_err`.
- `cargo test --manifest-path packages/desktop-rust/Cargo.toml --test storage storage -- --nocapture` and strict clippy failed before storage verification because unowned `src/auth/twitch_connect.rs`/`src/auth/local_callback.rs` currently have duplicate/missing symbols and lint errors.
- Task 3 did not modify those files; storage-only diagnostics and targeted formatting passed.

## 2026-05-31 - Task 5 verification blockers outside ownership

- Required command `cargo test --manifest-path packages/desktop-rust/Cargo.toml overlay -- --nocapture` failed due unrelated compile errors in `src/services/backend_ws.rs` tests (`Frame` missing `Debug` for `expect_err`).
- `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` failed due pre-existing errors in `src/auth/twitch_connect.rs` and `src/auth/local_callback.rs` outside Task 5 ownership.

## 2026-05-31 - Task 8 blocker log

- No new Task 8 blockers encountered; required packaging/build verification commands completed successfully.

## 2026-05-31T18:46:24+03:00 - Task 9 verification note

- Required `cargo test ... ui_visuals` and `cargo test ... tab_behavior` name-filter commands returned 0 matched tests in this workspace state (pass with all tests filtered). Equivalent explicit suite runs (`--test ui_visuals`, `--test tab_behavior`) were executed and passed to provide functional evidence.

## 2026-05-31 - Task 11 final full verification residual

- Mandatory final full-suite command still fails: `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` exits `101` on `home_emote_sources_include_all_connected_platforms` (`tests/app_state.rs:81:5`, missing expected `kick-7tv`).
- This reproduces baseline F-013 and remains the only failing mandatory final command; strict fmt/clippy and package verifier pass.

## 2026-05-31 - F4 scope fidelity blocker

- `packages/desktop-rust/Cargo.toml` includes a new `[profile.release]` block (`opt-level`, `lto`, `codegen-units`, `panic`, `strip`, `debug`) that is not documented in Task 10's guardrails evidence and is outside the stated docs/no-op metadata scope.
- Treat release/profile changes as scope-sensitive: they can affect packaged binary behavior and should be explicitly planned, evidenced, and verified before approval.

## 2026-05-31T19:43:37+03:00 - F4 scope blocker resolution

- Removed the out-of-scope `[profile.release]` block from `packages/desktop-rust/Cargo.toml` as scope creep per F4 REJECT.
- Preserved Task 10 no-op guardrail metadata (`[package.metadata.twirchat.desktop-rust.guardrails]`) and existing `[profile.dev.package."*"] incremental = false` unchanged.
