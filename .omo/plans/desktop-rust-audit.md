# Desktop Rust Audit and Fix Plan

## TL;DR

> **Summary**: Audit all of `packages/desktop-rust` for Rust correctness, panic/index safety, performance, async/concurrency hazards, and AI-agent-safe Rust patterns; fix every validated issue with regression evidence.
> **Deliverables**:
>
> - Baseline verification report with command outputs and exit codes
> - Severity-ranked finding log for all audited subsystems
> - Fixes for validated P0/P1/P2 issues and justified P3 tooling/style issues
> - Regression tests or targeted verification for every fix
> - Final full verification evidence and reusable Rust guardrails for future agents
>   **Effort**: XL
>   **Parallel**: YES - 5 waves
>   **Critical Path**: Baseline verification → read-only audit log → serialized subsystem fixes → final full verification → multi-agent review

## Context

### Original Request

User asked in Russian to go through all `desktop-rust`, find Rust antipatterns, performance improvement opportunities, and potential bugs such as index/array overflow, without missing mistakes, and to identify best Rust patterns for AI agents.

### Interview Summary

- Scope is `packages/desktop-rust` plus package-level Cargo/workspace verification needed to validate it.
- User selected **audit + fix all validated issues + regression tests**.
- User selected **Max Safe** strictness: formatter, clippy `-D warnings`, full tests, packaging verification; Miri/property/fuzz only where feasible and isolated.
- User selected **Rust-first**: behavior changes are allowed when safer/faster and tested; existing parity tests remain regression guards but TypeScript parity is not allowed to weaken Rust safety.

### Metis Review (gaps addressed)

- Added severity tiers so “fix all antipatterns” does not become an unbounded rewrite.
- Added baseline verification before edits to avoid confusing pre-existing failures with regressions.
- Added read-only audit waves before fix waves.
- Added exclusive file/module ownership for fix waves to avoid conflicting edits.
- Added public contract guardrails for SQLite schema, config, overlay params, RPC/event payloads, and packaging paths.
- Added no-live-service rule for Twitch/Kick/YouTube/OAuth tests.
- Added evidence requirement for performance changes.

## Work Objectives

### Core Objective

Make `packages/desktop-rust` safer and more idiomatic by finding and fixing validated Rust correctness, panic-safety, indexing, async/concurrency, storage, packaging, UI, and performance issues while preserving or explicitly documenting tested Rust-first behavior changes.

### Deliverables

- `.omo/evidence/task-1-baseline.md`
- `.omo/evidence/task-2-finding-log.md`
- `.omo/evidence/task-3-storage-db.md`
- `.omo/evidence/task-4-panic-index.md`
- `.omo/evidence/task-5-overlay-async.md`
- `.omo/evidence/task-6-platform-protocol.md`
- `.omo/evidence/task-7-chat-performance.md`
- `.omo/evidence/task-8-build-packaging.md`
- `.omo/evidence/task-9-ui-edge-cases.md`
- `.omo/evidence/task-10-tooling-guardrails.md`
- `.omo/evidence/task-11-final-verification.md`

### Definition of Done (verifiable conditions with commands)

- Baseline and final verification evidence exists under `.omo/evidence/`.
- Every validated P0/P1/P2 finding is fixed or has a documented non-fix reason in the finding log.
- Every correctness/panic/index/behavior-change fix has a regression test or targeted command proving the issue cannot recur.
- Final commands pass:
  ```sh
  cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check
  cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings
  cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features
  bun run package:desktop-rust:verify
  ```
- No tests rely on live Twitch/Kick/YouTube/OAuth services.

### Must Have

- Severity rubric:
  - P0: panic/data loss/memory safety/security/unchecked index or overflow reachable from user, config, network, DB, file, or package input.
  - P1: correctness/concurrency/runtime bug, poisoned-lock crash, invalid state transition, recoverable error treated as panic.
  - P2: performance issue with evidence: hot-path clone/collect churn, lock-held I/O, avoidable allocation, release-mode timing regression, or benchmarkable latency.
  - P3: style/tooling/idiom issue only; fix only when local, low-risk, and not a drive-by rewrite.
- Finding log schema: `file`, `issue`, `severity`, `evidence`, `fix decision`, `test command`, `result`, `behavior change note`.
- Regression tests for all P0/P1 fixes.
- Performance evidence for all P2 fixes: benchmark, before/after allocation reasoning, release-mode timing, or targeted stress test output.
- Contract tests for any change to persisted DB schema, config formats, overlay params, RPC/event payloads, packaging paths, or release artifact layout.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No broad architecture rewrite unless tied to a validated P0/P1 issue.
- No drive-by cleanup outside files owned by the active task.
- No live platform/API calls in tests.
- No `unwrap`, `expect`, `panic!`, unchecked indexing/slicing, unchecked integer casts, or blocking runtime calls introduced in production code without local proof and justification.
- No global Miri/property/fuzz infrastructure unless a narrow stable target is identified and isolated.
- No weakening Rust safety to match TypeScript behavior.
- No final completion before F1-F4 review agents approve and the user explicitly says okay.

## Verification Strategy

> ZERO HUMAN INTERVENTION - all verification is agent-executed.

- Test decision: tests-after with regression-first where a failing test can be written before the fix; framework is Rust `cargo test` plus package verification.
- QA policy: Every task has agent-executed happy and failure/edge scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`
- Mandatory commands:
  ```sh
  cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check
  cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings
  cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features
  bun run package:desktop-rust:verify
  ```
- Optional isolated commands only when task identifies a stable target:
  ```sh
  cargo +nightly miri test --manifest-path packages/desktop-rust/Cargo.toml <target>
  cargo test --manifest-path packages/desktop-rust/Cargo.toml <property_or_stress_test_name> -- --nocapture
  ```

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Tasks 1-2 — baseline verification and read-only finding log. Parallel: NO; baseline must happen before audits finalize.
Wave 2: Tasks 3-6 — read-only/deep audits and local fixes by exclusive subsystem ownership. Parallel: YES after Task 2 creates the finding log; ownership prevents conflicts.
Wave 3: Tasks 7-10 — performance, packaging, UI, and tooling guardrail fixes. Parallel: YES if file ownership remains exclusive.
Wave 4: Task 11 — final verification and evidence consolidation. Parallel: NO.
Wave 5: F1-F4 — final independent review agents. Parallel: YES; wait for user okay before completion.

### Dependency Matrix (full, all tasks)

- Task 1 blocks Tasks 2-11.
- Task 2 blocks Tasks 3-10.
- Task 4 blocks Task 8 for any packaging-test extension.
- Tasks 3-10 block Task 11.
- Task 11 blocks F1-F4.
- F1-F4 block completion and require explicit user approval.

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 2 tasks → `unspecified-high`, `deep`
- Wave 2 → 4 tasks → `deep`, `unspecified-high`
- Wave 3 → 4 tasks → `deep`, `unspecified-high`, `quick`
- Wave 4 → 1 task → `unspecified-high`
- Wave 5 → 4 review tasks → `oracle`, `unspecified-high`, `deep`

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Establish baseline verification and evidence

  **What to do**: Run the mandatory verification commands before any source edits. Capture exact command, working directory, exit code, and relevant output into `.omo/evidence/task-1-baseline.md`. If a command fails, do not fix it in this task; record it as baseline state.
  **Must NOT do**: Do not edit source files, manifests, or configs. Do not skip a command because it is expected to fail.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Requires disciplined command execution and evidence capture.
  - Skills: [`rust-best-practices`] - Rust verification command discipline.
  - Omitted: [`rust-async-patterns`] - No async design work in this task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: tasks 2-11 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Manifest: `packages/desktop-rust/Cargo.toml` - package under audit.
  - Package guide: `packages/desktop-rust/README.md` - local verify/run commands discovered by research.
  - Package instructions: `packages/desktop-rust/AGENTS.md` - package-specific validation rules discovered by research.
  - Root scripts: `package.json` - includes `package:desktop-rust:verify`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `.omo/evidence/task-1-baseline.md` exists and contains all four mandatory command invocations, exit codes, and results.
  - [ ] No source file changes are present after the task except evidence files.

  **QA Scenarios** (MANDATORY - task incomplete without these):

  ```
  Scenario: Baseline full command set
    Tool: Bash
    Steps: Run `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check`, `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings`, `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features`, and `bun run package:desktop-rust:verify`; record outputs.
    Expected: Evidence file records pass/fail status for every command with no source edits.
    Evidence: .omo/evidence/task-1-baseline.md

  Scenario: Baseline failure handling
    Tool: Bash
    Steps: If any baseline command fails, record the exact failing command and exit code, then run `git diff -- packages/desktop-rust`.
    Expected: Failure is documented and `git diff -- packages/desktop-rust` shows no source/config edits from this task.
    Evidence: .omo/evidence/task-1-baseline.md
  ```

  **Commit**: NO | Message: `chore(desktop-rust): record baseline verification` | Files: [.omo/evidence/task-1-baseline.md]

- [x] 2. Create severity-ranked full-package finding log

  **What to do**: Perform a read-only audit over all `packages/desktop-rust/src`, `packages/desktop-rust/tests`, `packages/desktop-rust/build.rs`, `packages/desktop-rust/Cargo.toml`, and relevant root scripts/workflows. Produce `.omo/evidence/task-2-finding-log.md` using the required schema. Search for `unwrap`, `expect`, `panic!`, direct indexing/slicing, unchecked casts/arithmetic, `unsafe`, lock use, blocking calls, clone/collect hotspots, env/path assumptions, and TODO/unimplemented patterns. Classify each finding P0-P3 using this plan’s rubric.
  **Must NOT do**: Do not edit code. Do not mark a subjective style preference above P3 without runtime, correctness, or maintenance evidence.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Requires whole-package reasoning and severity triage.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Rust audit and async hazard recognition.
  - Omitted: [`gpui`] - UI framework implementation is not changed in this read-only task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: tasks 3-10 | Blocked By: task 1

  **References**:
  - Module root: `packages/desktop-rust/src/lib.rs` - package module map.
  - Entry point: `packages/desktop-rust/src/main.rs` - GPUI startup and headless gating.
  - Known hotspots: `packages/desktop-rust/src/storage/db.rs`, `packages/desktop-rust/src/ui/components/animated_emote.rs`, `packages/desktop-rust/src/ui/components/input.rs`, `packages/desktop-rust/src/platforms/kick/client.rs`, `packages/desktop-rust/src/runtime/packaging.rs`, `packages/desktop-rust/src/overlay/server.rs`, `packages/desktop-rust/src/chat/aggregate.rs`, `packages/desktop-rust/src/chat/history.rs`, `packages/desktop-rust/build.rs`.
  - Tests: `packages/desktop-rust/tests/` - representative integration and parity coverage.

  **Acceptance Criteria**:
  - [ ] `.omo/evidence/task-2-finding-log.md` exists and includes `file`, `issue`, `severity`, `evidence`, `fix decision`, `test command`, `result`, and `behavior change note` columns or headings.
  - [ ] Finding log explicitly lists every known hotspot file from References, even if marked `no actionable finding`.
  - [ ] Finding log states which files/modules are owned by Tasks 3-10 to prevent edit overlap.

  **QA Scenarios**:

  ```
  Scenario: Full package audit coverage
    Tool: Bash
    Steps: Run non-mutating searches for the required risk classes under `packages/desktop-rust`; compare searched paths against `src`, `tests`, `build.rs`, and Cargo/package files.
    Expected: Evidence log covers every required path class and all known hotspot files.
    Evidence: .omo/evidence/task-2-finding-log.md

  Scenario: Severity threshold sanity check
    Tool: Bash
    Steps: Re-open the finding log and inspect all P0/P1/P2 entries for concrete evidence and a test command.
    Expected: No P0/P1/P2 entry exists without evidence and a planned verification command.
    Evidence: .omo/evidence/task-2-finding-log.md
  ```

  **Commit**: NO | Message: `chore(desktop-rust): record rust audit findings` | Files: [.omo/evidence/task-2-finding-log.md]

- [x] 3. Harden storage FFI, migrations, and corrupt DB recovery

  **What to do**: Own only `packages/desktop-rust/src/storage/**` and storage tests. Fix validated P0/P1 findings from Task 2 involving `unsafe` boundaries, SQLite pointer/lifetime handling, corrupt DB rename/recovery, migration edge cases, poisoned assumptions, path/env failures, and recoverable DB errors. Add or update regression tests in `packages/desktop-rust/tests/storage.rs` or appropriate storage unit tests. Document each fix in `.omo/evidence/task-3-storage-db.md`.
  **Must NOT do**: Do not change persisted DB schema or migration semantics unless a contract test is added and the behavior change is documented. Do not touch UI/platform/chat files.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: SQLite FFI and recovery logic can cause data loss or memory safety bugs.
  - Skills: [`rust-best-practices`] - Error handling, unsafe boundary review, tests.
  - Omitted: [`rust-async-patterns`] - Storage task is not primarily async unless findings prove otherwise.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: task 11 | Blocked By: tasks 1-2

  **References**:
  - Storage FFI: `packages/desktop-rust/src/storage/db.rs` - raw SQLite boundary and highest memory-safety audit target.
  - Storage module: `packages/desktop-rust/src/storage/mod.rs` - schema, migration, recovery, store factories.
  - Storage tests: `packages/desktop-rust/tests/storage.rs` - compatibility and recovery patterns.
  - Finding log: `.omo/evidence/task-2-finding-log.md` - authoritative fix list and severity.

  **Acceptance Criteria**:
  - [ ] All Task 2 P0/P1 storage findings are fixed or documented non-actionable with proof.
  - [ ] Storage regression tests cover corrupt DB, migration edge, missing/unwritable path where feasible, and recoverable SQLite errors without panic.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml storage -- --nocapture` passes.
  - [ ] `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` passes or pre-existing baseline failure is explicitly unchanged.

  **QA Scenarios**:

  ```
  Scenario: Corrupt database recovery
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml storage -- --nocapture`.
    Expected: Corrupt DB and migration tests pass; no recoverable DB/config input causes panic.
    Evidence: .omo/evidence/task-3-storage-db.md

  Scenario: Unsafe boundary regression
    Tool: Bash
    Steps: Run `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings`; if a narrow Miri target is stable, run `cargo +nightly miri test --manifest-path packages/desktop-rust/Cargo.toml storage` and record feasibility/result.
    Expected: Clippy passes or unchanged baseline failure is documented; Miri is either passed for a narrow target or explicitly marked infeasible with reason.
    Evidence: .omo/evidence/task-3-storage-db.md
  ```

  **Commit**: YES | Message: `fix(desktop-rust): harden storage recovery and ffi boundaries` | Files: [packages/desktop-rust/src/storage/**, packages/desktop-rust/tests/storage.rs, .omo/evidence/task-3-storage-db.md]

- [x] 4. Remove panic-prone indexing and unwrap paths in runtime packaging code

  **What to do**: Own only `packages/desktop-rust/src/runtime/packaging.rs` and packaging tests needed for runtime packaging config/index findings. Replace recoverable panics with `Result`, `.get()`, iterators, checked conversions, or explicit invariant types. Add regression tests for malformed config, empty architecture arrays, invalid indexes, and overflow-like boundary values.
  **Must NOT do**: Do not remove test-only `unwrap`/`expect` unless it obscures a production regression. Do not change public packaging layout without contract tests.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Focused correctness hardening across several production modules.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Panic policy, Result propagation, websocket/runtime invariants.
  - Omitted: [`gpui`] - UI panic paths are handled in Task 9.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: tasks 8, 11 | Blocked By: tasks 1-2

  **References**:
  - Packaging runtime: `packages/desktop-rust/src/runtime/packaging.rs` - direct `architectures[0]` risk from scan.
  - Packaging tests: `packages/desktop-rust/tests/packaging.rs` - contract test patterns.
  - Finding log: `.omo/evidence/task-2-finding-log.md`.

  **Acceptance Criteria**:
  - [ ] No validated production P0/P1 dynamic indexing, slicing, recoverable `unwrap`, `expect`, or `panic!` remains in owned files.
  - [ ] Regression tests cover malformed packaging channel/config and empty architecture arrays.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging -- --nocapture` passes.

  **QA Scenarios**:

  ```
  Scenario: Malformed packaging config cannot panic
    Tool: Bash
    Steps: Add/run a regression test with empty or malformed architecture/channel data, then run `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging -- --nocapture`.
    Expected: Code returns a typed error or safe fallback; no index panic occurs.
    Evidence: .omo/evidence/task-4-panic-index.md

  Scenario: Packaging boundary values are checked
    Tool: Bash
    Steps: Run targeted packaging tests with empty arrays, single-item arrays, malformed channel data, and large size/count values where applicable.
    Expected: All malformed or boundary inputs return deterministic errors or safe defaults without unchecked indexing or overflow.
    Evidence: .omo/evidence/task-4-panic-index.md
  ```

  **Commit**: YES | Message: `fix(desktop-rust): replace panic-prone packaging invariants` | Files: [packages/desktop-rust/src/runtime/packaging.rs, packages/desktop-rust/tests/packaging.rs, .omo/evidence/task-4-panic-index.md]

- [x] 5. Fix overlay server concurrency and runtime hazards

  **What to do**: Own only `packages/desktop-rust/src/overlay/**` and overlay tests. Resolve validated Task 2 findings around `Arc<Mutex<...>>` poisoning, lock held during socket writes, client retain/broadcast critical sections, blocking sleeps, malformed query parameters, disconnect/reconnect handling, and asset-path safety. Prefer short lock scopes, snapshot-then-write patterns, typed errors, and deterministic tests.
  **Must NOT do**: Do not introduce a separate Vite/dev server or live OBS dependency. Do not change overlay URL/query contract unless tests document the new Rust-first behavior.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Concurrency and server lifecycle changes need careful regression coverage.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Lock scoping, blocking policy, error propagation.
  - Omitted: [`vue3-best-practices`] - This is Rust overlay server, not Vue overlay implementation.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: task 11 | Blocked By: tasks 1-2

  **References**:
  - Overlay server: `packages/desktop-rust/src/overlay/server.rs` - OBS HTTP/WS server and client registry.
  - Overlay tests: `packages/desktop-rust/tests/overlay_server.rs` - server/asset behavior patterns.
  - Backend WS tests: `packages/desktop-rust/tests/backend_ws.rs` - disconnect/reconnect/malformed payload patterns useful for server QA.
  - Finding log: `.omo/evidence/task-2-finding-log.md`.

  **Acceptance Criteria**:
  - [ ] Broadcast/client registry code does not hold a global lock while performing socket writes when Task 2 identified that risk as actionable.
  - [ ] Poisoned lock or disconnected client paths do not panic in production code.
  - [ ] Overlay tests cover malformed query params, missing asset, disconnect cleanup, and successful broadcast.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml overlay -- --nocapture` passes.

  **QA Scenarios**:

  ```
  Scenario: Overlay happy path broadcast
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml overlay -- --nocapture` with a test that connects a local client and broadcasts a message.
    Expected: Client receives the message and server records no panic or stuck lock.
    Evidence: .omo/evidence/task-5-overlay-async.md

  Scenario: Overlay malformed/disconnect path
    Tool: Bash
    Steps: Run overlay tests for malformed query params, missing assets, and client disconnect before/while broadcasting.
    Expected: Server returns expected error/status or removes the client; no panic or deadlock occurs.
    Evidence: .omo/evidence/task-5-overlay-async.md
  ```

  **Commit**: YES | Message: `fix(desktop-rust): harden overlay server concurrency` | Files: [packages/desktop-rust/src/overlay/**, packages/desktop-rust/tests/overlay_server.rs, .omo/evidence/task-5-overlay-async.md]

- [x] 6. Harden platform adapters, protocol decoding, and auth error boundaries

  **What to do**: Own `packages/desktop-rust/src/platforms/**`, `packages/desktop-rust/src/protocol/**`, `packages/desktop-rust/src/auth/**`, and their tests. This task exclusively owns Kick socket invariant fixes, including `packages/desktop-rust/src/platforms/kick/client.rs`. Fix validated P0/P1 findings for malformed platform payloads, websocket decoding, reconnect state, OAuth callback cancel/error paths, invalid URLs, and recoverable network/protocol failures. Use fixtures/mocks only. Document intentional Rust-first behavior changes in evidence.
  **Must NOT do**: Do not make live Twitch/Kick/YouTube/OAuth calls. Do not weaken typed protocol errors into silent drops unless explicitly tested and documented.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Multiple external-facing boundaries and protocol contracts.
  - Skills: [`rust-best-practices`, `rust-async-patterns`] - Typed errors, async state, reconnection safety.
  - Omitted: [`7tv-events-api`] - Task is TwirChat platform adapters, not 7TV EventAPI unless Task 2 finds a direct 7TV dependency.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: task 11 | Blocked By: tasks 1-2

  **References**:
  - Twitch client: `packages/desktop-rust/src/platforms/twitch/client.rs` - parser/client and parse panic tests from scan.
  - Kick client/adapter: `packages/desktop-rust/src/platforms/kick/` - socket and adapter behavior.
  - YouTube adapter: `packages/desktop-rust/src/platforms/youtube/` - adapter behavior.
  - Auth server: `packages/desktop-rust/src/auth/server.rs` - local OAuth callback boundary.
  - Protocol tests: `packages/desktop-rust/tests/protocol.rs`, `packages/desktop-rust/tests/backend_ws.rs`, `packages/desktop-rust/tests/auth.rs`, `packages/desktop-rust/tests/twitch_adapter.rs`, `packages/desktop-rust/tests/kick_adapter.rs`, `packages/desktop-rust/tests/youtube_adapter.rs`.

  **Acceptance Criteria**:
  - [ ] Malformed platform/protocol/auth inputs return typed errors or tested safe drops, not panics.
  - [ ] WebSocket disconnect/reconnect and malformed payload tests pass.
  - [ ] OAuth callback error/cancel paths are covered by tests.
  - [ ] Focused commands pass for protocol/backend/auth/platform tests, using one Cargo test filter per command: `protocol`, `backend_ws`, `auth`, `twitch_adapter`, `kick_adapter`, and `youtube_adapter`.

  **QA Scenarios**:

  ```
  Scenario: Protocol happy path round trip
    Tool: Bash
    Steps: Run protocol/backend WS tests that serialize and deserialize valid messages.
    Expected: Valid messages round-trip and reconnect flows preserve expected state.
    Evidence: .omo/evidence/task-6-platform-protocol.md

  Scenario: Malformed external payloads and OAuth errors
    Tool: Bash
    Steps: Run tests with malformed JSON/platform payloads and OAuth callback error/cancel parameters using local fixtures only.
    Expected: Code returns typed/tested error paths without live calls or panics.
    Evidence: .omo/evidence/task-6-platform-protocol.md
  ```

  **Commit**: YES | Message: `fix(desktop-rust): harden platform and protocol boundaries` | Files: [packages/desktop-rust/src/platforms/**, packages/desktop-rust/src/protocol/**, packages/desktop-rust/src/auth/**, relevant tests, .omo/evidence/task-6-platform-protocol.md]

- [x] 7. Reduce chat aggregation/history hot-path allocation and clone churn

  **What to do**: Own `packages/desktop-rust/src/chat/**` and chat tests. Fix validated P2 findings in `aggregate.rs` and `history.rs` by reducing unnecessary clones, intermediate collects, whole-vector copies, lock duration, or avoidable allocations while preserving tested chat semantics. Add stress/regression tests for empty history, large history, duplicate messages, replay, and multibyte/Unicode message content. Record before/after evidence.
  **Must NOT do**: Do not change message ordering, dedupe semantics, or event identity without explicit tests and behavior notes. Do not optimize by making code less safe or by adding unchecked indexing.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Performance-sensitive domain logic with correctness constraints.
  - Skills: [`rust-best-practices`] - Borrowing vs cloning, iterators, benchmarking mindset.
  - Omitted: [`rust-async-patterns`] - Chat aggregation is domain/performance work unless Task 2 finds async hazards.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: task 11 | Blocked By: tasks 1-2

  **References**:
  - Aggregation hot path: `packages/desktop-rust/src/chat/aggregate.rs` - clone/collect churn from scan.
  - History hot path: `packages/desktop-rust/src/chat/history.rs` - vector copy/merge/insert patterns from scan.
  - Chat tests: `packages/desktop-rust/tests/chat_domain.rs` - dedupe, domain behavior, performance patterns.
  - Shared models: `packages/desktop-rust/src/models.rs` - message/event types.

  **Acceptance Criteria**:
  - [ ] All Task 2 validated P2 chat performance findings are fixed or documented non-actionable with evidence.
  - [ ] Regression tests cover empty history, large history, duplicate/replay behavior, and Unicode/multibyte message content.
  - [ ] Before/after performance evidence is recorded using a targeted test, release-mode timing, allocation reasoning, or benchmark output.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_domain -- --nocapture` passes.

  **QA Scenarios**:

  ```
  Scenario: Chat behavior preserved under load
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml chat_domain -- --nocapture` after adding/confirming large-history and duplicate tests.
    Expected: Ordering, dedupe, replay, and empty-history behavior pass without panics.
    Evidence: .omo/evidence/task-7-chat-performance.md

  Scenario: Performance evidence recorded
    Tool: Bash
    Steps: Run a targeted release-mode timing/stress test or benchmark for aggregation/history before and after fixes; record method and output.
    Expected: Evidence shows reduced clone/collect churn or no regression with a safety/correctness rationale.
    Evidence: .omo/evidence/task-7-chat-performance.md
  ```

  **Commit**: YES | Message: `perf(desktop-rust): reduce chat allocation churn` | Files: [packages/desktop-rust/src/chat/**, packages/desktop-rust/tests/chat_domain.rs, .omo/evidence/task-7-chat-performance.md]

- [x] 8. Harden build script, packaging contract, and environment/path handling

  **What to do**: Own `packages/desktop-rust/build.rs`, release-contract/package verification tests, and packaging tests only after Task 4 is complete. Do not edit `packages/desktop-rust/src/runtime/packaging.rs`; Task 4 owns that file. Replace recoverable build/package env/path panics with clear errors where appropriate; test missing env, malformed paths, missing overlay assets, and artifact verification failures. Preserve release artifact layout unless an explicit contract test documents Rust-first behavior.
  **Must NOT do**: Do not change installer/release artifact names or Velopack contract without updating verification tests. Do not make tests depend on developer-local env vars.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Build/release contract changes affect distribution.
  - Skills: [`rust-best-practices`] - Error handling and path/env robustness.
  - Omitted: [`rust-async-patterns`] - No async runtime work.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: task 11 | Blocked By: tasks 1-2, task 4

  **References**:
  - Build script: `packages/desktop-rust/build.rs` - build-time env/config and asset extraction.
  - Packaging runtime: `packages/desktop-rust/src/runtime/packaging.rs` - contract/path generation owned by Task 4; reference only unless Task 4 is reopened.
  - Packaging tests: `packages/desktop-rust/tests/packaging.rs` - artifact verification and missing asset patterns.
  - CI workflow: `.github/workflows/release.yml` - release build and artifact verification context.
  - Root script: `package.json` - `package:desktop-rust:verify` wrapper.

  **Acceptance Criteria**:
  - [ ] Missing/invalid env/path/asset cases produce deterministic errors or testable failures, not unexplained panics.
  - [ ] Packaging contract tests cover required assets and missing overlay asset failures.
  - [ ] `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging -- --nocapture` passes.
  - [ ] `bun run package:desktop-rust:verify` passes or unchanged baseline failure is documented with exact reason.

  **QA Scenarios**:

  ```
  Scenario: Packaging happy path contract
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_artifact_contains_required_assets -- --nocapture` and `bun run package:desktop-rust:verify`.
    Expected: Required package assets and artifact contract verify successfully.
    Evidence: .omo/evidence/task-8-build-packaging.md

  Scenario: Missing asset/env failure path
    Tool: Bash
    Steps: Run `cargo test --manifest-path packages/desktop-rust/Cargo.toml packaging_missing_overlay_asset_fails -- --nocapture` plus any added missing-env/path tests.
    Expected: Missing asset/env/path cases fail with deterministic typed or textual errors, not index/unwrap panics.
    Evidence: .omo/evidence/task-8-build-packaging.md
  ```

  **Commit**: YES | Message: `fix(desktop-rust): harden packaging and build inputs` | Files: [packages/desktop-rust/build.rs, packages/desktop-rust/tests/packaging.rs, package release-contract tests if present, .omo/evidence/task-8-build-packaging.md]

- [x] 9. Make GPUI UI render paths panic-safe and Unicode-safe

  **What to do**: Own `packages/desktop-rust/src/ui/**` except files already owned by overlay/server tasks. Fix validated P0/P1/P2 findings in `components/input.rs`, `components/animated_emote.rs`, `platforms.rs`, and related UI files. Replace render-path `unwrap`/poisoned-lock panics with safe fallbacks, validate animation frame access, handle Unicode/multibyte input boundaries, and keep storage/network logic out of render/update paths. Add/update UI behavior tests.
  **Must NOT do**: Do not move DB/network work into GPUI render/update paths. Do not use unchecked string byte indexes for user text. Do not inline broad visual rewrites unrelated to findings.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: UI render paths can crash the desktop app and need targeted tests.
  - Skills: [`rust-best-practices`, `gpui`] - Panic-safe Rust and GPUI component boundaries.
  - Omitted: [`vue3-best-practices`] - This is Rust GPUI, not Vue.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: task 11 | Blocked By: tasks 1-2

  **References**:
  - Input component: `packages/desktop-rust/src/ui/components/input.rs` - render/prepaint unwrap risk from scan.
  - Animated emote: `packages/desktop-rust/src/ui/components/animated_emote.rs` - mutex/frame indexing/cache risks from scan.
  - Platform panel: `packages/desktop-rust/src/ui/platforms.rs` - map lookup/state risks from scan.
  - UI module: `packages/desktop-rust/src/ui/mod.rs` - component split.
  - Tests: `packages/desktop-rust/tests/ui_visuals.rs`, `packages/desktop-rust/tests/tab_behavior.rs`, `packages/desktop-rust/tests/user_card.rs`.

  **Acceptance Criteria**:
  - [ ] Validated UI render-path panics are replaced with safe fallbacks or typed state checks.
  - [ ] Unicode/multibyte input boundary tests pass.
  - [ ] Animated emote lifecycle tests cover empty frames, failed load fallback, and cleanup where feasible.
  - [ ] Focused UI commands pass, using one Cargo test filter per command: `ui_visuals`, `tab_behavior`, and `user_card`.

  **QA Scenarios**:

  ```
  Scenario: UI happy path renders expected state
    Tool: Bash
    Steps: Run focused UI tests for visuals, tabs, and user card behavior.
    Expected: Existing UI behavior remains tested and passing after panic-safety changes.
    Evidence: .omo/evidence/task-9-ui-edge-cases.md

  Scenario: UI failure and Unicode boundaries
    Tool: Bash
    Steps: Run added tests for multibyte input cursor/edit boundaries, empty animated-emote frames, failed image fallback, and missing platform lookup.
    Expected: UI state falls back safely without panic or unchecked indexing.
    Evidence: .omo/evidence/task-9-ui-edge-cases.md
  ```

  **Commit**: YES | Message: `fix(desktop-rust): make ui render paths panic safe` | Files: [packages/desktop-rust/src/ui/**, packages/desktop-rust/tests/ui_visuals.rs, packages/desktop-rust/tests/tab_behavior.rs, packages/desktop-rust/tests/user_card.rs, .omo/evidence/task-9-ui-edge-cases.md]

- [x] 10. Add narrow Rust guardrails for future AI agents

  **What to do**: Own only `packages/desktop-rust/Cargo.toml`, package-level lint/config files if introduced, `packages/desktop-rust/AGENTS.md` if it exists, and minimal tests needed to prove guardrails. Add low-risk guardrails from Task 2/Metis: documented lint policy, command checklist, local justifications for any clippy waivers, and optional narrow deny/warn lints that do not create noisy unrelated churn. Evaluate Miri/property/fuzz targets only for stable pure logic surfaces; document why each is added or deferred.
  **Must NOT do**: Do not add global cargo-fuzz/Miri/proptest infrastructure unless a narrow target is identified and stable. Do not mass-fix style-only warnings across unrelated files. Do not create a root Rust workspace unless Task 2 proves it is necessary and low-risk.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Guardrail changes should be small and controlled after audits/fixes.
  - Skills: [`rust-best-practices`] - Clippy/lint policy and agent-safe Rust patterns.
  - Omitted: [`rust-async-patterns`] - Only needed if adding async-specific lint/docs from a validated finding.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: task 11 | Blocked By: tasks 1-2

  **References**:
  - Package manifest: `packages/desktop-rust/Cargo.toml` - possible lint/dependency guardrails.
  - Package instructions: `packages/desktop-rust/AGENTS.md` - package-specific agent guidance discovered by research.
  - Root instructions: `AGENTS.md` - project tool conventions.
  - External guidance from research: Clippy lint groups, Rust panic/error handling, Tokio blocking policy, Cargo profiles, Miri/proptest/fuzz applicability.

  **Acceptance Criteria**:
  - [ ] Future-agent guardrails document panic/indexing/error/async/performance policies from this plan.
  - [ ] Any new lint or config passes final mandatory commands.
  - [ ] Any waiver uses local justification, preferably `#[expect(...)]` with reason rather than blanket `allow`.
  - [ ] `.omo/evidence/task-10-tooling-guardrails.md` states whether Miri/property/fuzz was added or deferred and why.

  **QA Scenarios**:

  ```
  Scenario: Guardrails do not break normal verification
    Tool: Bash
    Steps: Run `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` and `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings`.
    Expected: Guardrail changes pass or only unchanged baseline failures remain documented.
    Evidence: .omo/evidence/task-10-tooling-guardrails.md

  Scenario: Optional advanced tooling is isolated
    Tool: Bash
    Steps: If Miri/property/fuzz was added, run the exact narrow target command documented in evidence; otherwise record deferral reason.
    Expected: Added advanced tooling has a stable narrow command, or deferral is justified by scope/reliability.
    Evidence: .omo/evidence/task-10-tooling-guardrails.md
  ```

  **Commit**: YES | Message: `chore(desktop-rust): add rust safety guardrails` | Files: [packages/desktop-rust/Cargo.toml, packages/desktop-rust/AGENTS.md, optional package-level lint/config files, .omo/evidence/task-10-tooling-guardrails.md]

- [x] 11. Run final full verification and consolidate evidence

  **What to do**: After Tasks 3-10 finish, run all mandatory final commands, all targeted regression commands cited by fixed findings, and inspect the finding log to ensure every validated issue is closed or documented non-actionable. Produce `.omo/evidence/task-11-final-verification.md` with command outputs, exit codes, changed contract notes, and remaining known limitations.
  **Must NOT do**: Do not fix new issues in this task unless they are trivial evidence/report corrections; if source changes are needed, reopen the owning subsystem task and rerun this final task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Requires careful evidence consolidation and gatekeeping.
  - Skills: [`rust-best-practices`] - Final Rust verification discipline.
  - Omitted: [`gpui`, `rust-async-patterns`] - Review is command/evidence oriented unless failures point to those domains.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: F1-F4 | Blocked By: tasks 3-10

  **References**:
  - Baseline: `.omo/evidence/task-1-baseline.md` - compare final vs baseline.
  - Finding log: `.omo/evidence/task-2-finding-log.md` - closure checklist.
  - Task evidence: `.omo/evidence/task-3-storage-db.md` through `.omo/evidence/task-10-tooling-guardrails.md`.
  - Manifest: `packages/desktop-rust/Cargo.toml`.
  - Root script: `package.json`.

  **Acceptance Criteria**:
  - [ ] Final mandatory commands pass with exit code 0, or any remaining failure is proven pre-existing and accepted in the finding log with exact evidence.
  - [ ] Every P0/P1/P2 finding is marked `fixed`, `not reproducible`, or `non-actionable` with evidence.
  - [ ] Every behavior change has a documented contract note and test command.
  - [ ] `.omo/evidence/task-11-final-verification.md` exists.

  **QA Scenarios**:

  ```
  Scenario: Final mandatory verification
    Tool: Bash
    Steps: Run `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check`, `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings`, `cargo test --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features`, and `bun run package:desktop-rust:verify`.
    Expected: All commands pass, or any unchanged baseline failure is explicitly documented and not caused by this work.
    Evidence: .omo/evidence/task-11-final-verification.md

  Scenario: Finding log closure audit
    Tool: Bash
    Steps: Inspect `.omo/evidence/task-2-finding-log.md` and task evidence files; verify each P0/P1/P2 has closure status, test command, and result.
    Expected: No unresolved validated P0/P1/P2 issue remains.
    Evidence: .omo/evidence/task-11-final-verification.md
  ```

  **Commit**: NO | Message: `chore(desktop-rust): record final verification` | Files: [.omo/evidence/task-11-final-verification.md]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [x] F1. Plan Compliance Audit — oracle
  - Prompt: Verify every TODO acceptance criterion and QA scenario was executed or has documented non-actionable evidence. Check `.omo/evidence/task-*.md`, final command outputs, and finding log closure. Verdict must be APPROVE/REJECT.
  - Evidence: `.omo/evidence/f1-plan-compliance.md`
- [x] F2. Code Quality Review — unspecified-high
  - Prompt: Review the final diff for Rust antipatterns, AI slop, broad rewrites, unsafe/unwrap/index regressions, unreviewed clippy waivers, and module ownership violations. Verdict must be APPROVE/REJECT.
  - Evidence: `.omo/evidence/f2-code-quality.md`
- [x] F3. Real Manual QA — unspecified-high
  - Prompt: Execute command-level QA from Task 11 and any runnable UI/package checks available in headless mode. Do not require live Twitch/Kick/YouTube/OAuth. Verdict must be APPROVE/REJECT.
  - Evidence: `.omo/evidence/f3-real-qa.md`
- [x] F4. Scope Fidelity Check — deep
  - Prompt: Compare user request, plan scope, finding log, and final diff. Confirm the work focused on desktop-rust Rust safety/performance/bugs/agent patterns and did not drift into unrelated rewrites. Verdict must be APPROVE/REJECT.
  - Evidence: `.omo/evidence/f4-scope-fidelity.md`

## Commit Strategy

- Commit after each successful fix wave if the executor is instructed to commit.
- Commit message examples:
  - `fix(desktop-rust): harden storage error handling`
  - `fix(desktop-rust): remove panic-prone UI paths`
  - `perf(desktop-rust): reduce chat history clone churn`
  - `test(desktop-rust): add regression coverage for packaging config`
- Do not commit baseline-only evidence unless the execution workflow explicitly commits `.omo/evidence` files.

## Success Criteria

- Finding log covers every file and risk category listed in this plan.
- All validated P0/P1/P2 issues are fixed or explicitly marked non-actionable with proof.
- Final mandatory commands pass.
- Final review wave approves.
- User explicitly approves completion after review results are presented.
