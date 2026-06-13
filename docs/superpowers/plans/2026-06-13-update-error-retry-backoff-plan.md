# Update Error Silent Retry with Backoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress update-check error toasts until 5 consecutive retryable failures and accelerate periodic retry intervals with backoff.

**Architecture:** `UpdateState` tracks consecutive retryable errors and derives the next check interval. `UpdateRuntime` classifies `Offline` errors as retryable and `Failed` as fatal, emitting a new `UpdateEvent::RetryableError` that increments the counter silently. The update state service reads the snapshot's `next_check_interval` to schedule the next periodic check.

**Tech Stack:** Rust, GPUI, Velopack, `cargo test`.

---

## File Map

- `packages/desktop-rust/src/runtime/update.rs` — core state machine, retry counting, backoff table, classification of retryable vs fatal errors.
- `packages/desktop-rust/src/services/update_state.rs` — consumes snapshot's `next_check_interval` to drive the periodic check timer.
- `packages/desktop-rust/src/ui/shell/app.rs` — no changes; UI already renders from snapshot/payload.

---

### Task 1: Update UpdateState/UpdateEvent with retry counting and backoff

**Files:**
- Modify: `packages/desktop-rust/src/runtime/update.rs:167-188` (add `RetryableError` variant)
- Modify: `packages/desktop-rust/src/runtime/update.rs:230-253` (add fields to `UpdateState`, `UpdateStatusSnapshot`)
- Modify: `packages/desktop-rust/src/runtime/update.rs:255-429` (update `Default`, `apply`, `snapshot`, helpers)
- Modify: `packages/desktop-rust/src/runtime/update.rs:431-525` (update `UpdateRuntime::run_check` classification)

- [ ] **Step 1: Write the failing test**

Add a new test in `packages/desktop-rust/src/runtime/update.rs` inside `mod tests` (append at the end before the closing brace):

```rust
#[test]
fn four_retryable_errors_do_not_emit_payload() {
    let mut state = UpdateState::default();
    for i in 1..=4 {
        let payload = state.apply(UpdateEvent::RetryableError {
            message: format!("retryable error {i}"),
        });
        assert!(payload.is_none(), "error {i} should be suppressed");
    }
    assert_eq!(state.consecutive_errors, 4);
}
```

Run:
```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo test four_retryable_errors_do_not_emit_payload -- --nocapture
```
Expected: FAIL due to unknown `RetryableError` variant and unknown `consecutive_errors` field.

- [ ] **Step 2: Add RetryableError variant and state fields**

In `packages/desktop-rust/src/runtime/update.rs`:

1. Add variant to `UpdateEvent`:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum UpdateEvent {
    Command(UpdateStateCommand),
    ServiceEvent(UpdateStateEvent),
    Status {
        status: UpdateStatus,
        message: String,
        progress: Option<f64>,
        hash: Option<String>,
    },
    UpdateAvailable {
        version: Option<String>,
        hash: Option<String>,
    },
    NoUpdate {
        source: UpdateCheckSource,
        message: String,
    },
    Error {
        message: String,
    },
    RetryableError {
        message: String,
    },
}
```

2. Add fields to `UpdateState`:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct UpdateState {
    show: bool,
    status: Option<UpdateStatus>,
    message: String,
    progress: Option<f64>,
    hash: Option<String>,
    skipped_hash: Option<String>,
    auto_check_updates: bool,
    auto_dismiss_after_ms: Option<u64>,
    pub consecutive_errors: u32,
    pub last_retryable_error: Option<String>,
}
```

3. Add field to `UpdateStatusSnapshot`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusSnapshot {
    pub show: bool,
    pub status: Option<String>,
    pub message: String,
    pub progress: Option<f64>,
    pub hash: Option<String>,
    pub skipped_hash: Option<String>,
    pub auto_check_updates: bool,
    pub auto_dismiss_after_ms: Option<u64>,
    pub next_check_interval_ms: u64,
}
```

4. Update `Default` for `UpdateState`:

```rust
impl Default for UpdateState {
    fn default() -> Self {
        Self {
            show: false,
            status: None,
            message: String::new(),
            progress: None,
            hash: None,
            skipped_hash: None,
            auto_check_updates: true,
            auto_dismiss_after_ms: None,
            consecutive_errors: 0,
            last_retryable_error: None,
        }
    }
}
```

5. Implement helper:

```rust
impl UpdateState {
    pub const MAX_RETRYABLE_ERRORS_BEFORE_NOTIFICATION: u32 = 5;

    pub fn backoff_interval(&self) -> Duration {
        match self.consecutive_errors {
            0 => UPDATE_CHECK_INTERVAL,
            1 => Duration::from_secs(15),
            2 => Duration::from_secs(30),
            _ => Duration::from_secs(60),
        }
    }

    fn reset_retry_errors(&mut self) {
        self.consecutive_errors = 0;
        self.last_retryable_error = None;
    }
}
```

6. Update `apply`:

```rust
UpdateEvent::RetryableError { message } => {
    self.consecutive_errors += 1;
    self.last_retryable_error = Some(message.clone());
    if self.consecutive_errors >= Self::MAX_RETRYABLE_ERRORS_BEFORE_NOTIFICATION {
        self.reset_retry_errors();
        self.apply_status(UpdateStatus::Error, message, None, None)
    } else {
        None
    }
}
```

7. Update `apply_no_update` and `UpdateAvailable` handler to call `self.reset_retry_errors()` before applying status.

8. Update `snapshot`:

```rust
pub fn snapshot(&self) -> UpdateStatusSnapshot {
    UpdateStatusSnapshot {
        show: self.show,
        status: self.status.map(|status| status.as_str().to_string()),
        message: self.message.clone(),
        progress: self.progress,
        hash: self.hash.clone(),
        skipped_hash: self.skipped_hash.clone(),
        auto_check_updates: self.auto_check_updates,
        auto_dismiss_after_ms: self.auto_dismiss_after_ms,
        next_check_interval_ms: self.backoff_interval().as_millis() as u64,
    }
}
```

9. Update `UpdateRuntime::run_check` to classify `Offline` as retryable and `Failed` as fatal:

```rust
fn run_check(&mut self, source: UpdateCheckSource) {
    match self.engine.check(&self.request) {
        Ok(Some(update)) => {
            let stable_hash = stable_skip_identifier(update.version.as_deref(), update.hash);
            self.available_update = Some(AvailableUpdate {
                version: update.version.clone(),
                hash: stable_hash.clone(),
            });
            let _ = self.dispatch(UpdateEvent::UpdateAvailable {
                version: update.version,
                hash: stable_hash,
            });
        }
        Ok(None) => {
            self.available_update = None;
            let _ = self.dispatch(UpdateEvent::NoUpdate {
                source,
                message: "No updates available".to_string(),
            });
        }
        Err(UpdateEngineError::Offline(message)) => {
            let _ = self.dispatch(UpdateEvent::RetryableError { message });
        }
        Err(UpdateEngineError::Failed(message)) => {
            let _ = self.dispatch(UpdateEvent::Error { message });
        }
    }
}
```

Run:
```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo test four_retryable_errors_do_not_emit_payload -- --nocapture
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-rust/src/runtime/update.rs
git commit -m "feat(runtime): add retryable error counting and backoff interval"
```

---

### Task 2: Wire backoff interval into update_state service loop

**Files:**
- Modify: `packages/desktop-rust/src/services/update_state.rs:16-89`

- [ ] **Step 1: Write the failing test**

No new file; instead run existing tests to ensure the change compiles and behavior is correct:

```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo test update_state -- --nocapture
```

Expected: This may not exist yet; note result and proceed.

- [ ] **Step 2: Modify service loop to use dynamic interval**

In `packages/desktop-rust/src/services/update_state.rs`:

1. Track current poll interval with a mutable variable, initialized from the parameter `poll_interval`.

2. After handling any `UpdateStateCommand::CheckForUpdates` (both explicit and periodic), read the runtime snapshot and update the poll interval:

```rust
let mut poll_interval = poll_interval;
```

At the top of `run_update_state_service`:

```rust
let mut poll_interval = poll_interval;
```

Inside the `UpdateStateCommand::CheckForUpdates` branch, after `runtime.dispatch_command(command)` and publishing the snapshot:

```rust
poll_interval = runtime.snapshot().next_check_interval_ms;
```

But `recv_timeout` takes a `Duration`. Convert:

```rust
let next = runtime.snapshot().next_check_interval_ms;
poll_interval = Duration::from_millis(next);
```

Make sure this happens for both the explicit `CheckForUpdates` branch and the periodic timer path. The simplest way is to update `poll_interval` at the bottom of each loop iteration based on the current snapshot.

Replace:

```rust
match commands.recv_timeout(poll_interval) {
```

with a variable that is updated after dispatch:

```rust
match commands.recv_timeout(poll_interval) {
```

and at the end of the loop (after the match, before `}`) add:

```rust
poll_interval = Duration::from_millis(runtime.snapshot().next_check_interval_ms);
```

This covers both explicit commands and timeouts.

3. Ensure the initial `poll_interval` is used only for the first `recv_timeout`.

Run:
```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo test --test runtime -- --nocapture
```
Expected: PASS (or existing failures unrelated to this change).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-rust/src/services/update_state.rs
git commit -m "feat(services): use update state's backoff interval for periodic checks"
```

---

### Task 3: Add unit tests for retry/backoff behavior

**Files:**
- Modify: `packages/desktop-rust/src/runtime/update.rs` inside `mod tests`

- [ ] **Step 1: Write the failing tests**

Append the following tests at the end of `mod tests` in `packages/desktop-rust/src/runtime/update.rs`:

```rust
#[test]
fn fifth_retryable_error_emits_error_payload_with_last_message() {
    let mut state = UpdateState::default();
    for i in 1..=4 {
        let payload = state.apply(UpdateEvent::RetryableError {
            message: format!("retryable error {i}"),
        });
        assert!(payload.is_none(), "error {i} should be suppressed");
    }
    let payload = state.apply(UpdateEvent::RetryableError {
        message: "retryable error 5".to_string(),
    });
    let payload = payload.expect("5th error should surface");
    assert_eq!(payload.status, "error");
    assert_eq!(payload.message, "retryable error 5");
    assert_eq!(state.consecutive_errors, 0);
    assert!(state.last_retryable_error.is_none());
}

#[test]
fn success_resets_retryable_error_counter() {
    let mut state = UpdateState::default();
    for i in 1..=3 {
        let _ = state.apply(UpdateEvent::RetryableError {
            message: format!("retryable error {i}"),
        });
    }
    let _ = state.apply(UpdateEvent::NoUpdate {
        source: UpdateCheckSource::Periodic,
        message: "No updates available".to_string(),
    });
    assert_eq!(state.consecutive_errors, 0);
    assert!(state.last_retryable_error.is_none());
}

#[test]
fn fatal_error_is_emitted_immediately() {
    let mut state = UpdateState::default();
    let payload = state.apply(UpdateEvent::Error {
        message: "fatal update error".to_string(),
    });
    let payload = payload.expect("fatal error should surface immediately");
    assert_eq!(payload.status, "error");
    assert_eq!(payload.message, "fatal error should surface immediately");
}

#[test]
fn backoff_intervals_follow_expected_curve() {
    let mut state = UpdateState::default();
    assert_eq!(state.backoff_interval(), UPDATE_CHECK_INTERVAL);

    state.consecutive_errors = 1;
    assert_eq!(state.backoff_interval(), Duration::from_secs(15));

    state.consecutive_errors = 2;
    assert_eq!(state.backoff_interval(), Duration::from_secs(30));

    for count in [3, 4, 5, 10] {
        state.consecutive_errors = count;
        assert_eq!(
            state.backoff_interval(),
            Duration::from_secs(60),
            "count {count} should cap at 60s"
        );
    }
}

#[test]
fn snapshot_contains_next_check_interval_ms() {
    let mut state = UpdateState::default();
    state.consecutive_errors = 2;
    let snapshot = state.snapshot();
    assert_eq!(snapshot.next_check_interval_ms, 30_000);
}
```

Run:
```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo test update::tests:: -- --nocapture
```
Expected: FAIL because tests reference new fields/messages.

- [ ] **Step 2: Adjust implementation for test correctness**

Fix any compilation/test failures from Task 1/Task 2. Specifically verify:

- `UpdateEvent::Error` message in the fatal test is surfaced as-is; the test assertion in step 1 had a copy-paste bug (`payload.message` should equal `"fatal update error"`, not the test name). Update the test if needed.
- The `fatal_error_is_emitted_immediately` test name's assertion string was wrong; correct it to match the message.

Corrected test:

```rust
#[test]
fn fatal_error_is_emitted_immediately() {
    let mut state = UpdateState::default();
    let payload = state.apply(UpdateEvent::Error {
        message: "fatal update error".to_string(),
    });
    let payload = payload.expect("fatal error should surface immediately");
    assert_eq!(payload.status, "error");
    assert_eq!(payload.message, "fatal update error");
}
```

Run:
```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo test update::tests:: -- --nocapture
```
Expected: PASS.

- [ ] **Step 3: Run full package test suite**

```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-rust/src/runtime/update.rs
git commit -m "test(runtime): add retry counting and backoff interval tests"
```

---

## Self-Review Checklist

- [ ] Spec coverage: retry counting, threshold, backoff, fatal vs retryable, service loop interval, reset on success.
- [ ] No placeholders: every step has code and commands.
- [ ] Type consistency: `consecutive_errors`, `last_retryable_error`, `next_check_interval_ms` used consistently.

## Verification

Run before finishing:
```bash
cd /home/satont/Documents/Projects/chat/packages/desktop-rust && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```
Expected: clean formatting, no clippy warnings, all tests pass.
