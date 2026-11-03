# Linux close to tray

The tray icon previously existed independently of the window close policy. An OS close
destroyed the native window, disposed its React root, and exited the process after the last
window closed. The new native policy hides the tray owner and retains its window, React tree,
and backend. Tray activation restores the same window; Quit and explicit programmatic close
still remove it. A window without a successfully created tray closes normally.

X11 uses unmap/map requests. Wayland null-attaches the surface, suppresses presentation while
hidden, drains old events through a display-sync barrier, and performs a fresh configure
handshake before presenting again. Restoring also reapplies the title, app ID, size limits,
and requested fullscreen/maximized state.

## Verification

All GUI activity used the isolated `qa:gui` launcher with private profiles, displays, and,
where requested, a private D-Bus. No host desktop or production profile was used.

| Check                                                                                         | Result                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Before fix, old native SHA `cd10c5ab9042a0ef0c485c3b320f7862128b78e6809fba8aa4181ad1a379d248` | Both genuine X11 and Wayland close tests failed because `isWindowOpen()` became false                                                   |
| [X11 native fixture](x11.json)                                                                | Three close/restore cycles; hidden updates remain hidden; other windows close; removing the tray restores ordinary close                |
| [Wayland native fixture](wayland.json)                                                        | Five genuine compositor close/restore cycles; 50 hidden updates; latest content paints after restore; explicit close works while hidden |
| [Compiled production app with tray](production-tray.json)                                     | Three close/restore cycles through both SNI activation and Open; Quit while hidden exits with code 0                                    |
| [Compiled production app without tray](production-without-tray.json)                          | Last-window close exits with code 0                                                                                                     |
| Production build smoke                                                                        | Bun 1.4.4, React 19.3.1, production React/JSX, native API 3, packaged runtime verified                                                  |
| TypeScript / lint / format                                                                    | Passed in the isolated MR checkout with Bun 1.4.4                                                                                       |
| MR contract tests                                                                             | 14 passed: 10 GUI isolation/parser tests and four native build contract tests                                                           |
| Full workspace tests                                                                          | 1164 passed: 31 quality, 23 shared, 254 backend, 856 desktop; 15 PostgreSQL integration tests skipped                                   |
| Native release tests                                                                          | Pinned `test:native` exited successfully; 310 tests in the harness                                                                      |

The Weston-only QA module calls `weston_desktop_surface_close` inside the private compositor
to emit an actual `xdg_toplevel.close`. It is opt-in through `--weston-controls`; the application
and ordinary benchmark sessions do not load it.

The isolated MR checkout is based on `1455a1dd59690e5e17aed753825f1b1c120c25f1`, including
the merged Twitch badge changes. `bun run fix`, `bun run lint`, `bun run typecheck`, and the
14 targeted contract tests all passed with Bun 1.4.4.
[MR typecheck output](mr-typecheck.txt) records the current result. All four GUI probes and the
full workspace suite also passed on this MR base. Full-load measurements retain their original
source provenance in the benchmark report.

[Restored production window](production-restored.png).

## Reproduction

Run from `packages/desktop` after `bun run build`:

```sh
bun run qa:gui --dbus --node-env production --keep --timeout 60 -- bun scripts/qa-tray.tsx
bun run qa:gui --compositor weston --weston-controls --dbus --node-env production --keep --timeout 90 -- bun scripts/qa-wayland-tray.tsx
bun run qa:gui --dbus --node-env production --keep --timeout 60 -- bun scripts/qa-built-app.ts bin/twirchat
bun run qa:gui --node-env production --keep --timeout 45 -- bun scripts/qa-built-app.ts bin/twirchat
```

## Provenance

The attached X11, Wayland, compiled production app, and screenshot evidence was replayed in the
isolated MR worktree on `1455a1dd59690e5e17aed753825f1b1c120c25f1` plus this change. Earlier
before-fix failures and performance measurements used frozen application sources at
`82552a53694517829df7500d6c4b96e44f87dd27`; their original provenance remains in the benchmark
report.
[Native manifest](native.json): API 3, version `0.11.0-twirchat.4`,
digest `9fb2fa0507af39a4`, 56,224,840 bytes, SHA-256
`32df77db2384eb22f77a2eb5442b9c67356d857720ee7248d80b35c4ed63bcf7`.

Performance evidence is recorded separately in
[`docs/benchmarks/2026-11-03-close-to-tray`](../../benchmarks/2026-11-03-close-to-tray/).
