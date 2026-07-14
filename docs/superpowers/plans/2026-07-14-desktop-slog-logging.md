# Desktop `slog` Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure one global text-formatted `slog` logger that writes to stderr and a timestamped file beside each desktop profile's SQLite data, and migrate all desktop Go logging to it.

**Architecture:** `internal/logging` owns handler construction and file lifecycle. It installs the result via `slog.SetDefault`; application packages use package-level `slog` functions. `main` configures it before Velopack, SQLite, services, or Wails start, and owns shutdown and the exit code.

**Tech Stack:** Go 1.26, standard `log/slog`, `github.com/samber/slog-multi`, Go testing, Bun repository checks.

## Global Constraints

- Create logs at `<profileDir>/logs/<UTC timestamp>/twirchat.log`.
- Use readable text output for stderr and file; never JSON.
- Install the global logger with `slog.SetDefault`.
- Do not attempt to recover native Windows/WebView2 crashes.
- Replace every `log.Printf` and `log.Fatal` in `packages/desktop`.

---

### Task 1: Add the central dual-sink logger

**Files:**

- Create: `packages/desktop/internal/logging/logging.go`
- Create: `packages/desktop/internal/logging/logging_test.go`
- Modify: `packages/desktop/go.mod`
- Modify: `packages/desktop/go.sum`

**Interfaces:**

- Produces: `func SetupLogger(profileDir string) (func() error, error)`.
- Consumes: `slogmulti.Fanout`, `slog.NewTextHandler`, `slog.SetDefault`.
- Used by: `packages/desktop/main.go`.

- [ ] **Step 1: Write the failing test**

```go
func TestSetupLoggerWritesReadableTextFile(t *testing.T) {
	profileDir := t.TempDir()
	closeLogger, err := SetupLogger(profileDir)
	if err != nil {
		t.Fatalf("SetupLogger() error = %v", err)
	}
	slog.Info("logger configured", "channel", "satont")
	if err := closeLogger(); err != nil {
		t.Fatalf("close logger: %v", err)
	}

	entries, err := os.ReadDir(filepath.Join(profileDir, "logs"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("log directories = %v, error = %v", entries, err)
	}
	content, err := os.ReadFile(filepath.Join(profileDir, "logs", entries[0].Name(), "twirchat.log"))
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	if !strings.Contains(string(content), "level=INFO msg=\"logger configured\" channel=satont") {
		t.Fatalf("unexpected text log: %s", content)
	}
}
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `go test ./internal/logging -run TestSetupLoggerWritesReadableTextFile -count=1`

Expected: FAIL because package `internal/logging` and `SetupLogger` do not exist.

- [ ] **Step 3: Add the dependency and minimal implementation**

Run `go get github.com/samber/slog-multi` in `packages/desktop`. Implement:

```go
func SetupLogger(profileDir string) (func() error, error) {
	logDir := filepath.Join(profileDir, "logs", time.Now().UTC().Format("20060102T150405.000000000Z"))
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}
	file, err := os.OpenFile(filepath.Join(logDir, "twirchat.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}
	handler := slogmulti.Fanout(
		slog.NewTextHandler(os.Stderr, nil),
		slog.NewTextHandler(file, nil),
	)
	slog.SetDefault(slog.New(handler))
	var closeOnce sync.Once
	var closeErr error
	return func() error {
		closeOnce.Do(func() { closeErr = errors.Join(file.Sync(), file.Close()) })
		return closeErr
	}, nil
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `go test ./internal/logging -run TestSetupLoggerWritesReadableTextFile -count=1`

Expected: PASS; the log contains text-formatted `INFO` and `channel=satont`.

- [ ] **Step 5: Commit the task**

```bash
git add packages/desktop/go.mod packages/desktop/go.sum packages/desktop/internal/logging
git commit -m "feat(desktop): add slog file logging"
```

### Task 2: Configure logging first and migrate all Go call sites

**Files:**

- Create: `packages/desktop/logging_migration_test.go`
- Modify: `packages/desktop/main.go`
- Modify: `packages/desktop/internal/app/application.go`
- Modify: `packages/desktop/internal/backend/http_client.go`
- Modify: `packages/desktop/internal/backend/ws_client.go`
- Modify: `packages/desktop/internal/watched/manager.go`
- Modify: `packages/desktop/internal/platforms/twitch/service.go`
- Modify: `packages/desktop/internal/platforms/kick/service.go`

**Interfaces:**

- Consumes: `logging.SetupLogger(profileDir string) (func() error, error)`.
- Produces: only `slog.Info`, `slog.Warn`, and `slog.Error` in application Go source.

- [ ] **Step 1: Write a failing migration assertion**

```go
func TestDesktopGoSourceUsesSlogInsteadOfLegacyLog(t *testing.T) {
	err := filepath.WalkDir(".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(content), "\"log\"") || strings.Contains(string(content), "log.Printf") || strings.Contains(string(content), "log.Fatal") {
			t.Errorf("legacy log usage remains in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk Go sources: %v", err)
	}
}
```

- [ ] **Step 2: Run the assertion to verify it fails**

Run: `go test . -run TestDesktopGoSourceUsesSlogInsteadOfLegacyLog -count=1`

Expected: FAIL and identify the current application source files that use `log`.

- [ ] **Step 3: Refactor startup and log calls**

Use this process boundary:

```go
func main() { os.Exit(runMain()) }

func runMain() int {
	profileDir, err := profileDirectory()
	if err != nil {
		slog.Error("resolve profile directory", "error", err)
		return 1
	}
	closeLogger, err := logging.SetupLogger(profileDir)
	if err != nil {
		slog.Error("configure logging", "error", err)
		return 1
	}
	defer func() {
		if err := closeLogger(); err != nil {
			slog.Error("close log file", "error", err)
		}
	}()
	if err := run(profileDir); err != nil {
		slog.Error("application startup failed", "error", err)
		return 1
	}
	return 0
}
```

Move previous startup code to `run(profileDir string) error`. Replace each `log.Fatal` with a contextual `fmt.Errorf` return. Convert each `log.Printf` to `slog.Info` or `slog.Error` with named attributes. Preserve context and omit credentials.

- [ ] **Step 4: Format and run focused tests**

```bash
gofmt -w main.go internal/app/application.go internal/backend/http_client.go internal/backend/ws_client.go internal/watched/manager.go internal/platforms/twitch/service.go internal/platforms/kick/service.go internal/logging/logging.go internal/logging/logging_test.go logging_migration_test.go
go test ./internal/logging -count=1
go test . -run TestDesktopGoSourceUsesSlogInsteadOfLegacyLog -count=1
```

Expected: PASS, and `rg -n --glob '*.go' '"log"|log\.(Printf|Fatal)' .` has no application-source matches.

- [ ] **Step 5: Commit the task**

```bash
git add packages/desktop
git commit -m "refactor(desktop): migrate logging to slog"
```

### Task 3: Verify the integrated desktop build

**Files:**

- Verify: `packages/desktop/**`

**Interfaces:**

- Consumes: all logging changes from Tasks 1 and 2.
- Produces: a formatted, tested desktop logging implementation.

- [ ] **Step 1: Run the full desktop Go suite**

Run: `go test ./...`

Expected: PASS.

- [ ] **Step 2: Run the repository-required checks**

```bash
bun run fix
bun run lint
bun run typecheck
```

Expected: every command exits successfully. Inspect any changes created by `bun run fix`.

- [ ] **Step 3: Review and commit**

```bash
git diff --check
git status --short
git add packages/desktop docs/superpowers/plans/2026-07-14-desktop-slog-logging.md
git commit -m "test(desktop): verify slog logging migration"
```

Expected: clean worktree with no unrelated frontend changes.
