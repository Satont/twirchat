# Silent Update Check Retry with Backoff

## Goal
When the desktop app cannot reach the Velopack update feed due to a retryable (offline/network) error, suppress the user-facing error toast until the failure repeats 5 times in a row, and use an accelerated backoff interval for subsequent retry attempts.

## Background
The current `UpdateRuntime::run_check` dispatches `UpdateEvent::Error` for every `UpdateEngineError::Offline` or `UpdateEngineError::Failed`, which the UI renders as an "Update failed" toast. Network blips therefore produce frequent, noisy notifications. Periodic checks already run every 60 seconds (`UPDATE_CHECK_INTERVAL`), but there is no distinction between retryable transient failures and fatal failures, and no escalation of retry cadence.

## Requirements
1. Distinguish retryable errors from fatal errors in the update runtime.
2. Count consecutive retryable errors.
3. Do **not** show an error toast while the consecutive retryable error count is below 5.
4. On the 5th consecutive retryable error, show one toast containing the message of the most recent (5th) error.
5. Reset the consecutive error counter on any successful check result (`NoUpdate`, `UpdateAvailable`, etc.).
6. Use an accelerated backoff interval for periodic checks after retryable errors: `15s, 30s, 60s, 60s, ...` capped at 60s.
7. Fatal errors must still be shown immediately.
8. User-initiated "Check for updates" may show the transient state but must not flash an error toast until the 5-retry threshold is crossed.

## Non-requirements
- This change does not add HTTP-level retries inside a single `check` call; it only changes how repeated check failures are surfaced and scheduled.
- Download/apply errors are out of scope; they remain immediately surfaced.

## Architecture
`UpdateState` becomes the source of truth for retry counting and the current backoff interval. A new `UpdateEvent::RetryableError` is emitted only for retryable failures, increments the counter silently, and derives the next check interval from a fixed backoff table. The UI and service layer consume the snapshot's `next_check_interval` to drive the periodic check timer. Fatal errors continue to emit `UpdateEvent::Error` and surface immediately.

## Components

### `runtime/update.rs`
- Add `consecutive_errors: u32` and `last_retryable_error: Option<String>` to `UpdateState`.
- Add `UpdateEvent::RetryableError { message: String }`.
- Classify `UpdateEngineError::Offline` as retryable; `UpdateEngineError::Failed` as fatal.
- Implement `UpdateState::backoff_interval() -> Duration` returning 15s/30s/60s/60s based on `consecutive_errors`.
- Update `UpdateState::apply`:
  - `RetryableError` increments `consecutive_errors`, stores message, returns `None` unless count >= 5, then returns `UpdateStatus::Error` with the stored message.
  - Any success resets `consecutive_errors` and `last_retryable_error`.
- Include `next_check_interval: u64` (ms) in `UpdateStatusSnapshot`.

### `services/update_state.rs`
- Read the snapshot after each check command and use `snapshot.next_check_interval` as the `recv_timeout` duration for the next loop iteration.

### `ui/shell/app.rs`
- No functional change required; it already reads the snapshot to render the toast. The suppression happens because no payload is emitted until the threshold is crossed.

### `runtime/update.rs` tests
- Add unit tests for:
  - 4 retryable errors produce no visible payload.
  - 5th retryable error produces an error payload with the 5th message.
  - A success resets the counter.
  - Fatal error produces a payload immediately.
  - Backoff interval values at error counts 0..5.

## Data Flow
1. Periodic timer or user action triggers `UpdateStateCommand::CheckForUpdates`.
2. `UpdateRuntime::run_check` calls `engine.check`.
3. On success: `UpdateEvent::NoUpdate` or `UpdateEvent::UpdateAvailable` resets the counter.
4. On retryable error: `UpdateEvent::RetryableError` increments counter, stores message, emits no payload (or error payload if threshold reached).
5. Service loop reads `snapshot.next_check_interval` and waits accordingly.
6. UI renders only emitted payloads; errors below threshold are invisible.

## Testing
- Run `cargo test` in `packages/desktop-rust`.
- New unit tests in `runtime/update.rs`.
- Existing integration tests in `tests/runtime.rs` should continue to pass.

## Open Questions
- Should the "Checking..." toast still appear for user-initiated checks while errors are suppressed? Yes, it is independent of error surfacing.
