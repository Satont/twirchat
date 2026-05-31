# Decisions

## 2026-05-31 - Task 5 overlay async findings

- Fixed F-003 by enforcing `MAX_WEBSOCKET_FRAME_BYTES = 1_048_576` in overlay `read_frame` immediately after length decoding and before payload allocation.
- Fixed F-006 by restructuring `broadcast_text` to avoid holding the shared clients mutex during network writes; write/prune now happens outside the lock.
- Treated F-012 as safe-to-fix: replaced constant 10ms accept-loop sleep with bounded exponential backoff (`10ms` to `100ms`, reset on accept).

## 2026-05-31 - Task 4 non-actionable packaging index finding

- Did not modify `packages/desktop-rust/src/runtime/packaging.rs` because the only index expression (`architectures[0]`) is not reachable from runtime/config/user-controlled malformed input under current architecture.
- Kept behavior unchanged and documented proof in `.omo/evidence/task-4-panic-index.md`.

## 2026-05-31 - Task 8 build/package hardening decisions

- Kept `packages/desktop-rust/src/runtime/packaging.rs` unchanged per Task 4 non-actionable conclusion and Task 8 scope guardrail.
- Hardened `build.rs` with explicit error propagation and deterministic diagnostics while preserving generated file names and content contract.
- Rejected extra positional args in `release-contract <stable-tag>` mode to prevent silent CLI misuse.

## 2026-05-31T19:10:00+03:00 - Task 10 guardrail policy decisions

- Did not add broad deny-by-default linting to `packages/desktop-rust/Cargo.toml`; the current package has many test fixture `unwrap`/`expect` call sites plus intentional SQLite FFI, so a global deny policy would create noisy unrelated churn.
- Chose a documentation-first guardrail in `packages/desktop-rust/AGENTS.md` and a no-op manifest metadata block instead of a behavior-changing lint policy.
- Deferred Miri/property/fuzz because no stable narrow pure-logic target was validated for this package during the audit.
