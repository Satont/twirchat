# Architecture refactoring log

The [architecture map](architecture.md) describes the current system. This log records completed changes and separates verified debt from changes that need a decision. Check all callers and preserve external contracts before retiring an implementation.

## Completed

### Round 1 — Own OAuth primitives in `shared`

- **Baseline:** `f18f73b`, Bun 1.4.4, pinned GPUIX build from `native/gpuix/source.json`. `bun run check` passed. `bun run test` passed with 1,729 tests and 27 skips after preparing the native artifact. Two isolated desktop test cases fail in a fresh worktree without that artifact; `bun run --cwd packages/desktop build:native` resolves this prerequisite.
- **Decision:** Move the two identical S256 challenge, verifier, and random-state implementations to `@twirchat/shared/pkce`. Importing one application from the other would invert the workspace dependency. Sharing OAuth sessions would conflate different storage, callback, expiry, and error contracts. Keep session ownership local.
- **Migration:** Hosted Kick and MemeAlerts and desktop Kick, YouTube, VK Play, Twir upload, MemeAlerts, and DonationAlerts now use the shared primitives where applicable. The desktop YouTube session logic remains in `auth/pkce-sessions.ts`; neither application keeps a copy or compatibility re-export of the primitives.
- **Safeguard:** Shared tests pin RFC 7636's S256 vector, verifier format, and random state shape. The desktop OAuth and image uploader tests and hosted donation OAuth tests cover provider-specific flow behavior. Independent review verified all import paths and unchanged crypto and session implementations. No external contract, persisted state, UI, or chat hot path changes.

### Round 2 — Own hosted app credentials outside stream status

- **Decision:** Move client-credentials grants and their caches to `backend/src/api/app-credentials.ts`. Keeping them in stream status makes unrelated features depend on a route implementation. One generic retry/cache client would conflate provider policies: Twitch coalesces grants and retries a Helix 401 once; Kick does neither. Share only the form grant, response parser, and refresh margin.
- **Migration:** Stream status, batch status, category search, Twitch users, badges, emote catalog, profile, and card metadata all use the credentials module. It keeps raw tokens private and owns Kick auth headers; batch status still acquires one set of headers per nonempty batch. The old stream-status exports are gone.
- **Safeguard:** Credential tests characterized the original implementation before extraction and pin coalescing, separate provider caches, the expiry margin, caller options, and the single Helix 401 retry. Backend test files run isolated so provider mocks and module-level caches cannot leak across suites. Independent review confirmed the full caller migration and the unchanged retry, timeout, and wire contracts.

### Round 3 — Enforce workspace import direction

- **Baseline:** The TypeScript and Vue import scan found no desktop↔backend or shared→app dependencies. `chat-layout-store.ts` was the one workspace consumer reaching shared through a filesystem path; it now imports from `@twirchat/shared/types`.
- **Decision:** Extend the existing Oxlint plugin rather than add a graph tool. Built-in import restrictions missed normalized relative paths and TypeScript import types. The rule enforces the audited package direction and shared entry points, not arbitrary dynamic resolution or internal package layering.
- **Safeguard:** `workspace-import-boundaries` is a CI lint error. Pinned CLI fixtures cover aliases, normalized relative paths, type imports, re-exports, literal dynamic imports, `require`, Vue scripts, and existing integration-test exceptions. The fixture runner checks imports from a nested working directory too.

### Round 4 — Keep desktop OAuth callbacks acyclic

- **Decision:** The local callback server owns browser responses; provider handlers own credential validation, exchanges, and account persistence. A separate HTML helper would break the import cycle but leave provider code responsible for the transport. No generic provider callback framework is needed.
- **Migration:** Kick, YouTube, and VK Play Live handlers return sign-in data to the server. The server renders the same success HTML after the existing sign-in completion, and owns VK Play Live's fragment-to-POST page. All three reverse imports are gone; Twitch device sign-in keeps its existing completion path.
- **Safeguard:** The desktop OAuth tests cover the actual request handler, including Kick and YouTube PKCE, VK Play Live's two callback methods, success and error HTML, unknown routes, and account/channel persistence. Oxlint's `import/no-cycle` is enabled for desktop auth; the existing desktop state cycles are not exempted inside that scope.

### Round 5 — Remove type-assisted cycles from desktop feature modules

- **Decision:** Keep the layout and streamer-mode API contracts with their implementing modules and compose them into `DesktopApi`. Move the shared logging settings and paint data shapes into type-only files so neither history nor cosmetics must be imported by the lower-level implementation. Do not move runtime validation, persistence, or rendering for this change.
- **Migration:** Layout and streamer mode no longer depend on the facade. Chat history and the file logger import the same settings type; cosmetics and the renderer import the same paint type. All callers of the moved types now import their owners, without re-exports or changes to method signatures.
- **Safeguard:** Enable Oxlint cycle checks with `ignoreTypes: false` for desktop auth, the in-process backend, and services. The type-inclusive baseline found eight diagnostics there and eight in desktop state; only the latter remain outside the guard. A mixed value/type import fixture fails under the configured rule. Focused tests cover layout persistence, streamer mode, chat logging/history, and paint rendering. Bun emits identical JavaScript for the changed application modules; both new contract files are type-only.

### Round 6 — Break the desktop state dependency cycle

- **Decision:** Give account and layout snapshots independent owners, and keep cold startup orchestration above the state modules. Moving the whole layout controller would expose its write queue and resize reconciliation to other modules. Keep those mechanics in place and move only the tab-close entry that must flush layout before closing.
- **Migration:** `accounts.ts` and `layout-state.ts` keep the existing HMR keys. `initial-data.ts` owns startup and retries. Layout flushes before normal tab close; closing the last pane, already inside the layout queue, calls the tab operation for an already-saved layout. Readers and QA scripts use the new owners directly.
- **Safeguard:** The import audit found no remaining strongly connected components in its resolved TS/Vue graph, including type-only and literal dynamic imports. The type-inclusive Oxlint rule now runs repository-wide. Layout, tab, unread, message-similarity, and history tests cover the preserved operations. The [performance comparison](benchmarks/2026-11-28-state-dependencies/report.md) records the full matrix, repeated production target and HMR QA.

### Round 7 — Enforce the desktop presentation boundary

- **Baseline:** TypeScript resolution found 33 distinct GPUIX imports into desktop `src/store` or `src/platforms`, all in `gpuix/backend`. No production caller needed migration.
- **Decision:** Extend the existing import rule and visitor instead of adding another resolver or an exception list. GPUIX code outside `gpuix/backend` must access stores and adapters through the desktop bridge. Other desktop modules can still call their own persistence and provider dependencies.
- **Safeguard:** CLI fixtures exercise allowed bridge imports and rejected relative paths, aliases, workspace links, file URLs, type imports, re-exports, and literal dynamic imports. The change only affects lint, tests, and documentation.

### Round 8 — Make desktop localization framework-independent

- **Decision:** Keep one translation engine, catalog pair, and active-language store in `desktop/src/i18n`. GPUIX hooks subscribe to that state; providers, plugins, and desktop services need neither React nor the GPUIX module graph to translate.
- **Migration:** Move the existing observable store factory and HMR resource registry into `desktop/src/state`, retaining the macrotask queue and resource keys. GPUIX uses hooks from `gpuix/state/use-store.ts` and `gpuix/hooks/use-translation.ts`; all consumers use the owning modules directly. The English and Russian catalogs are unchanged.
- **Safeguard:** Import lint keeps the two foundation directories independent of GPUIX and React, and allows imports of the translation hook only from presentation within desktop runtime source. Locale tests cover fixed-language translation, retained state, and deferred notifications. The [performance report](benchmarks/2026-11-28-localization/report.md) compares the matched matrix and production target.

## Next investigations

| Priority | Area                                | Evidence and next slice                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Dependencies and CI                 | Audit remaining imports from desktop services into GPUIX. Distinguish bridge contracts and framework-neutral logic from real presentation dependencies before adding more restrictions.                                                                                                                                                                                       |
| High     | Hosted credentials, retries, caches | Check late Helix 401 invalidation in `backend/src/api/app-credentials.ts` separately; a stale response can evict a newer Twitch token. Evaluate Kick grant coalescing and deadlines independently.                                                                                                                                                                            |
| High     | Desktop runtime lifetime            | `gpuix/backend/server.ts` boots listeners, intervals, sockets and managers, but the current `dispose()` does not own all their cleanup. Inventory resources and test process exit versus HMR before moving them. Preserve close-to-tray behavior and prevent stale async completions from reopening disposed resources.                                                       |
| High     | Desktop state and presentation      | `gpuix/state/app.ts` mixes backend event projection, chat buffers, and status polling; `gpuix/backend/api.ts` mixes several feature responsibilities. Keep the external seam and isolate one feature at a time. Use existing hot-path baselines before changing stores or ingestion. Audit overlapping UI primitives against actual GPUIX behavior before consolidating them. |
| Medium   | Data, API and compatibility         | Map which current and legacy clients own Kick account and OAuth routes, and which readers need the current SQLite settings/history formats. Keep independent single-channel and batch status error contracts while consolidating only equivalent provider calls. Characterize backend HTTP/WS authentication differences before any change.                                   |
| Medium   | Config, tooling and observability   | Compare desktop native pins in `source.json` and `native-runtime.ts`; validate that all targets consume the same authority before removing a copy. Reconcile environment docs against parsers and deployment templates. Inventory retry and log policies before adding generic infrastructure.                                                                                |
| Medium   | Docs and developer onboarding       | Root/package `AGENTS.md` and the GPUIX README still contain older runtime, package, and test descriptions. Link to canonical source for architecture, release scripts and generated contracts instead of copying implementation inventories into multiple guides.                                                                                                             |

## Awaiting a product or compatibility decision

- Removing legacy hosted Kick OAuth/account endpoints or old profile formats is out of scope until their supported client and upgrade windows are explicit. No removal is assumed by the refactor.
- Existing plugins are supported by the current runtime. Lua compatibility and new plugin capabilities are separate scope; neither is required to simplify ownership of the existing runtime.
