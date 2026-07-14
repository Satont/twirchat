# Wails startup diagnostics design

## Goal

Make a Windows launch failure diagnosable from the existing readable daily
`twirchat.log`, including failures that occur immediately after WebView2 creates
its Environment.

## Scope

- Configure Wails with the global `slog` logger and `slog.LevelDebug` so Wails
  system messages reach the same console-and-file fanout as application logs.
- Configure the central text handlers to accept debug entries; the current
  handlers otherwise discard them before the file sink sees them.
- Attach the Velopack native logger to the global logger, keeping its native
  level as a `component=velopack` attribute.
- Record unambiguous boundaries for the production startup hand-off, Wails
  application construction, main-window request, service start, Wails event
  loop entry, and normal event-loop return.
- Preserve the current UI, updater behaviour, log location, text format, and
  UTC daily grouping.

## Failure interpretation

- No `Velopack startup complete` record means Velopack exited or terminated
  during its launch/update handling.
- A missing `main WebView2 window requested` record locates the failure in the
  native Wails window request.
- A missing `Wails event loop entered` record after that boundary locates it in
  or immediately before `nativeApp.Run`.
- A Wails error/debug message immediately before the final boundary is retained
  in `%APPDATA%\\TwirChat\\logs\\YYYY-MM-DD\\twirchat.log`.

## Verification

- Unit-test that the central logger persists a debug record in its text file.
- Unit-test that Wails options use the current global logger, a `wails`
  component attribute, and debug level.
- Unit-test Velopack level mapping through the global logger.
- Run focused Go tests, `go test ./...`, `bun run fix`, `bun run lint`, and
  `bun run typecheck` before tagging.
