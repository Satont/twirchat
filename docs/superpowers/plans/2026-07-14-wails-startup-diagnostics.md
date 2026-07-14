# Wails Startup Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Wails and Velopack startup diagnostics into the existing daily text log without altering application or update behaviour.

**Architecture:** The existing global `slog` handler accepts debug records. Wails receives a child logger with `component=wails`; Velopack uses a level-mapping callback with `component=velopack`. The composition root and Wails host record boundaries around each native startup transition.

**Tech Stack:** Go 1.26, `log/slog`, Wails v3, Velopack Go, Go testing.

## Global Constraints

- Continue writing readable text at `%APPDATA%\\TwirChat\\logs\\YYYY-MM-DD\\twirchat.log` on Windows.
- Do not change update application, native-window behaviour, UI, or log retention.
- Do not emit JSON or credentials.

---

### Task 1: Prove debug and framework logger wiring

**Files:**

- Modify: `packages/desktop/internal/logging/logging_test.go`
- Modify: `packages/desktop/internal/app/application_test.go`
- Modify: `packages/desktop/internal/update/service_test.go`

- [ ] Write tests that require `slog.Debug` to be persisted, require Wails options to use a `wails` child of the global logger at `slog.LevelDebug`, and require Velopack levels to map to the global logger.
- [ ] Run `go test ./internal/logging ./internal/app ./internal/update -count=1`; expect compile/assertion failure because the diagnostic wiring does not yet exist.

### Task 2: Implement the diagnostics

**Files:**

- Modify: `packages/desktop/internal/logging/logging.go`
- Modify: `packages/desktop/internal/app/application.go`
- Modify: `packages/desktop/internal/update/service.go`
- Modify: `packages/desktop/main.go`

- [ ] Use `slog.HandlerOptions{Level: slog.LevelDebug}` for both text sinks.
- [ ] Extract Wails option construction, set `Logger: slog.Default().With("component", "wails")` and `LogLevel: slog.LevelDebug`, and log before/after the native window request plus before/after the Wails event loop.
- [ ] Pass a logger callback to `velopack.Run` that maps native trace/debug, info, warning, and error messages to `slog` records with `component=velopack`.
- [ ] Log immediately before and after `update.RunProductionStartup`.

### Task 3: Verify and release

- [ ] Run focused tests and `go test ./...` from `packages/desktop`.
- [ ] Run `bun run fix`, `bun run lint`, and `bun run typecheck` from the repository root.
- [ ] Review `git diff --check`, commit the diagnostic change, create the next patch tag, and push `main` plus the tag.
