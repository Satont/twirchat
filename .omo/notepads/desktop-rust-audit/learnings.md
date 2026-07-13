# Learnings

## 2026-05-31T17:27:40+03:00 - Task 1 baseline established

- Baseline commands executed from repo root `/home/satont/Documents/Projects/twirchat`.
- Result summary:
  - `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` => exit `1` (FAIL).
  - `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` => exit `0` (PASS).
  - `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features` => exit `101` (FAIL).
  - `bun run package:desktop-rust:verify` => exit `0` (PASS).
- Failure in `cargo test` is localized to `home_emote_sources_include_all_connected_platforms` in `tests/app_state.rs` during this baseline run.
- Baseline evidence captured in `.omo/evidence/task-1-baseline.md`.

## 2026-05-31 - Task 2 finding log synthesized

- Finding log created at `.omo/evidence/task-2-finding-log.md`.
- Highest-priority findings are UI panic paths, websocket unbounded allocation, OAuth callback blocking, and overlay lock-held socket writes.
- Baseline formatting/test failures are retained as F-013/F-014 so downstream tasks can close them deliberately.
- `src/runtime/packaging.rs` and `src/platforms/kick/client.rs` were downgraded from prior suspected hotspots to no actionable production finding unless implementation discovers a reachable path.

## 2026-05-31 - Task 6 platform/protocol/auth hardening

- F-004 is fixed in `src/services/backend_ws.rs` by enforcing a 1 MiB backend websocket payload cap before allocation and rejecting malformed 64-bit lengths with the reserved high bit set.
- F-005 is fixed by moving Twitch/Kick local OAuth callback handling to `src/auth/local_callback.rs`, with nonblocking accept timeout, per-stream read timeout, and bounded 8192-byte request reads.
- `src/platforms/kick/client.rs` no longer relies on a production `expect` for the socket pump invariant; absent sockets exit the pump loop without panicking.
- Rechecked `src/platforms/kick/adapter.rs`; the remaining direct slices are derived from in-string ASCII delimiter search while stripping `<img...>` tags, so no production socket-invariant issue was validated.

## 2026-05-31T17:49:16+03:00 - Task 3 storage recovery hardening

- F-009 was fixed by replacing `src/storage/mod.rs` corrupt-DB backup path `unreachable!` with bounded suffix selection and `StorageError::CorruptBackupPathExhausted`.
- `src/storage/db.rs` SQLite FFI unsafe clusters were reviewed as non-actionable: handles/statements remain RAII-owned, SQLite-owned strings are copied before release/finalize, and text binds use `SQLITE_TRANSIENT`.
- Storage verification is currently blocked by unrelated unowned auth/backend websocket compile errors; storage-only LSP diagnostics and targeted formatting passed.

## 2026-05-31 - Task 5 overlay concurrency hardening

- Overlay websocket frame parsing now enforces a strict 1 MiB maximum frame length before payload allocation/read.
- Overlay broadcasting no longer holds the global clients mutex during socket writes, reducing contention and avoiding lock-held I/O.
- Overlay accept loop now uses bounded backoff on `WouldBlock` (`10ms..100ms`) instead of constant 10ms polling.
- Overlay integration tests passed (`cargo test --manifest-path packages/desktop-rust/Cargo.toml --test overlay_server -- --nocapture`, 4 passed).

## 2026-05-31 - Task 4 runtime packaging panic/index verification

- Re-audited `packages/desktop-rust/src/runtime/packaging.rs` and `packages/desktop-rust/tests/packaging.rs` for panic/index hazards.
- Confirmed no `unwrap`, `expect`, or `panic!` in runtime packaging module.
- Found one direct index expression: `channel.architectures[0]` in `velopack_target_plan`.
- Verified current reachability is bounded to compile-time `TwirChatPackagingSpec::VELOPACK_CHANNELS` with non-empty architecture arrays, so no externally malformed input can trigger this path today.
- Recorded non-actionable proof in `.omo/evidence/task-4-panic-index.md`.
- Focused verification passed: `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging -- --nocapture`.

## 2026-05-31 - Task 7 chat aggregation/history performance

- F-007 was addressed by adding borrowed aggregation accessors: `inject_message_ref` avoids cloning the enriched message on direct hot-path ingestion, and `recent_messages` avoids cloning the full recent buffer for read-only callers. Owned APIs remain for compatibility and snapshot/replay semantics.
- F-008 was addressed by avoiding existing-id clones in `merge_older_page`, combining duplicate and insertion-position scans in `insert_live_message`, and adding `insert_live_message_in_place` for repeated live history updates without whole-vector copies.
- Chat-domain coverage now includes burst dedupe/order replay plus empty history, 1,024-message large history, older-page duplicate skipping, and Unicode/multibyte payload preservation.
- Required Task 7 verification passed: focused required `chat_domain` cargo filter, effective `--test chat_domain`, fmt check, strict clippy, and release-mode `chat_burst_performance`.

## 2026-05-31 - Task 8 build/package boundary hardening

- F-010 fixed in `packages/desktop-rust/build.rs` by replacing `expect`/`panic!` env-path-write failures with `Result` propagation and explicit diagnostics while preserving generated outputs under `OUT_DIR`.
- Kick badges source path resolution now derives from `CARGO_MANIFEST_DIR` to workspace-root-relative `packages/desktop/src/platforms/kick/badges.ts`, removing brittle sibling-only assumptions.
- F-011 fixed in `packages/desktop-rust/src/bin/release-contract.rs`: default `<stable-tag>` mode now rejects trailing args; added `release_contract_tag_mode_rejects_extra_args` in `tests/packaging.rs`.
- Required Task 8 checks passed: packaging tests, `bun run package:desktop-rust:verify`, `cargo fmt --check`, strict clippy.

## 2026-05-31T18:46:24+03:00 - Task 9 UI panic-safety and Unicode boundary hardening

- F-001 fixed in `src/ui/components/animated_emote.rs`: replaced `animated_emote_cache().lock().unwrap()` usages with `AnimatedEmote::lock_cache()` that logs poisoned-lock errors and returns `None` fallback instead of panicking UI render paths.
- F-002 fixed in `src/ui/components/input.rs`: replaced prepaint/paint unwraps with guarded fallback behavior (missing prepaint line early return + paint error logging) while preserving input state updates.
- Added focused safety contract tests in `tests/ui_visuals.rs`, `tests/tab_behavior.rs`, and `tests/user_card.rs` to verify panic-removal and Unicode-boundary invariants.
- Required checks passed for this task: targeted UI tests (requested filters and explicit `--test` suites), `cargo fmt --check`, and strict clippy.

## 2026-05-31T19:10:00+03:00 - Task 10 tooling guardrails documented

- Added package-level guardrail guidance to `packages/desktop-rust/AGENTS.md` covering panic safety, untrusted frame caps, lock-held I/O avoidance, SQLite FFI invariants, GPUI render safety, performance evidence, local clippy waivers, and Miri/property/fuzz deferral.
- Added a non-functional `package.metadata.twirchat.desktop-rust.guardrails` block in `packages/desktop-rust/Cargo.toml` so the manifest carries the guardrail intent without introducing deny-by-default lint churn.
- Strict package verification passed again after the docs/metadata update: `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` and `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings`.

## 2026-05-31T19:27:28+03:00 - F-013 home emote source residual fixed

- Root cause was deterministic selection of the first watched channel matching `(platform, channel_slug == channel_login)` in `home_emote_source_channels`; with persisted test-state channels this could select a same-slug record without a tracked 7TV subscription mapping, skipping the expected Kick `kick-7tv` source.
- `home_emote_source_channels` now selects among matching watched channels by preferring entries that already have a `watched_seven_tv_channel_ids` mapping, preserving existing Twitch behavior while ensuring Kick home sources include mapped 7TV ids.
- Required verification reruns passed: targeted app_state regression, full `--all-targets --all-features` tests, `cargo fmt --check`, and strict clippy.
