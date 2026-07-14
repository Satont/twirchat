# Desktop `slog` logging design

## Goal

Replace all uses of Go's legacy `log` package in `packages/desktop` with a
single, process-wide `log/slog` logger. Startup and runtime messages must be
written to both the console and a readable, timestamped file located beside the
SQLite profile data.

## Logging API and lifecycle

- Add `internal/logging.SetupLogger(profileDir string) (func() error, error)`.
- It creates `profileDir/logs/<UTC timestamp>/twirchat.log`; the timestamp uses
  a filesystem-safe, collision-resistant layout.
- It builds a `slogmulti.Fanout` handler with two `slog.NewTextHandler`
  children: one for `os.Stderr`, one for the opened log file.
- It calls `slog.SetDefault` so package-level `slog.Info`, `slog.Warn`, and
  `slog.Error` share the configured logger throughout the process.
- `SetupLogger` returns a close function. `main` defers it after successful
  setup so buffered file data is flushed and the descriptor is closed during
  normal shutdown.
- Console and file output use the same readable text format with time, level,
  message and `key=value` attributes. Source locations are omitted by default
  to keep production logs readable.

## Startup flow and error handling

`main` determines the profile directory, configures the logger before
Velopack, SQLite, services, or Wails start, and delegates all following work to
`run(...) error`. It logs a returned error once at the process boundary instead
of calling `log.Fatal`, allowing deferred cleanup to run. If logging itself
cannot be configured, the unconfigured default `slog` logger remains the
fallback for the error message.

This change records Go-level startup failures. It intentionally does not claim
to recover native Windows/WebView2 crashes; WER/ProcDump remain the mechanism
for those crashes.

## Migration scope

- Replace every `log.Printf` and `log.Fatal` use under `packages/desktop` with
  the corresponding `slog` call.
- Preserve current information while converting interpolated values to
  structured attributes where they identify a field, such as `channel`,
  `status`, `path`, `method`, and `error`.
- No frontend TypeScript logger, backend package, or logging retention policy
  changes are in scope.

## Dependency choice

Use `github.com/samber/slog-multi` and its `Fanout` handler. The standard
library can duplicate an identical stream with `io.MultiWriter`, but `Fanout`
expresses the required two-handler design directly and keeps console and file
handler configuration independent without a locally maintained handler.

## Verification

- Add unit tests for log-directory creation and text-file output using a
  temporary profile directory.
- Add a test that checks the global default logger is installed and a cleanup
  function closes it without error.
- Run the focused Go tests first, then `go test ./...` in `packages/desktop`.
- Run the repository's required formatting and checks after implementation.
