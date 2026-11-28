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

### Round 9 — Remove reverse imports into the GPUIX application

- **Baseline:** Three imports from desktop source outside GPUIX pointed into the application, all for types. Those edges pulled 21 GPUIX files into the non-GPUIX TypeScript project despite its `exclude` setting.
- **Decision:** Keep window bounds with the session validator, chatter contracts with the desktop viewer-list feature, and moderation types with the moderation service or existing shared contract. Moving callers into GPUIX would hide the dependency rather than fix ownership. Window bounds and chatter DTO shapes are unchanged.
- **Safeguard:** Oxlint rejects desktop `src` imports into the local GPUIX tree from outside it, including type imports. The rule does not restrict tests, QA harnesses, or the existing direct native dependency of the window scale adapter. The non-GPUIX compilation now includes zero GPUIX application files. The 14 modified existing TypeScript modules emit identical JavaScript, and the new type module emits none; the localization benchmark remains the latest runtime evidence.

### Round 10 — Keep the desktop bridge independent of presentation

- **Baseline:** The bridge had two direct imports into the rest of GPUIX: the history exporter read a text formatter from chat search tools, and the updater read its Linux staging helper. The focused history, search, and updater suites passed 56 tests before migration.
- **Decision:** Keep one transcript formatter shared by clipboard and file export, and place Linux update staging with the desktop services. Moving the entire chat tools module would also move unrelated search and mention behavior. The moved helpers retain their original implementations; the transcript formatter no longer imports the search module or its PCRE2 initialization.
- **Safeguard:** Oxlint rejects imports from the bridge into other local GPUIX modules. This replaces the special-case translation hook restriction. The change does not modify ingestion, chat rendering, or the update staging algorithm; the previous performance evidence still covers the chat workload.

### Round 11 — Separate the desktop runtime and React capabilities

- **Decision:** Put the React context in presentation and give it a type-only contract for requests, subscriptions, and existing plugin controls. The runtime alone exposes event emission and shutdown to composition and QA. The provider still receives the original singleton; do not wrap it or split the event bus.
- **Migration:** Retarget all presentation and QA imports to `backend-context.ts` and type consumers to `backend/contract.ts`. The event map remains a desktop bridge contract, not a hosted protocol. Store and event implementations are unchanged.
- **Safeguard:** The bridge cannot directly import React, React DOM, or the known external GPUIX packages. Local bridge aliases remain allowed. Isolated HMR QA passed before and after the move, retaining the backend across eight remounts. The relocation does not change measured hot-path behavior.

### Round 12 — Give the donation bridge its own capability

- **Decision:** Compose `DonationsApi` into `DesktopApi` without changing its flat request names. Keep credentials, connection state, event publication, and lifecycle with their existing owners. Extract only the bridge that connects donation settings to those owners.
- **Safeguard:** Focused tests cover delegation, the event-loop turn before mutations, the updated sharing snapshot, and OAuth availability when no donation service is installed. The 18 existing donation tests passed before migration; they and the two new bridge tests passed afterward. Isolated donation settings QA passed on both revisions. No donation event delivery or chat hot path changed.

### Round 13 — Invalidate only the Twitch grant that Helix rejected

- **Decision:** Cache the bearer token and expiry as one grant. A late 401 can invalidate only the exact grant used for that request. Comparing bearer strings would not distinguish separate grants with the same token value.
- **Safeguard:** Deterministic tests hold one 401 until a second request has refreshed the grant, with both different and identical bearer values. Both cases required a redundant third grant before the fix. Refresh coalescing, the expiry margin, request deadlines, and the single Helix retry remain unchanged. Kick is outside this slice.

### Round 14 — Coalesce hosted Kick app-grant requests

- **Decision:** Share one in-flight Kick grant across concurrent status and category requests. The common app-grant request owns an 8-second deadline, matching the existing Twitch grant deadline; no caller can cancel the shared request. Keep the 60-second refresh margin and cache only a successfully parsed grant.
- **Safeguard:** Deferred fetch fixtures cover cold and near-expiry coalescing, timeout propagation to all waiters, and recovery on the next call. Before the change, the overlapping requests started four grants instead of two. User OAuth, webhook subscriptions, metadata updates, and downstream Kick data fetches are unchanged; the grant deadline is not a route deadline.

### Round 15 — Bound hosted Kick public reads

- **Decision:** Create one authenticated reader per Kick operation. Its 20-second budget begins before the independently bounded, shared grant lookup and is reused by every batch worker and response body. A per-channel timeout would let 20 waves wait independently. The desktop status poll runs every 30 seconds; this budget bounds the Kick leg, not database authentication or the parallel Twitch leg.
- **Safeguard:** The reader checks the deadline before starting a fetch. Characterization tests preserve single-status and category errors on upstream HTTP failures and the existing batch per-channel offline result. A transport timeout still rejects the batch, allowing the desktop to keep the previous snapshot. Tests also verify that successive batch waves share one signal and do not start queued reads after expiry. No grant retries or user OAuth changes.

### Round 16 — Keep hosted credential errors separate from user OAuth

- **Decision:** Failed app-grant HTTP responses are discarded at the grant boundary. Logs keep the provider and upstream status; public errors no longer include the upstream body or status, so older desktops do not interpret a grant rejection as expired user OAuth. HTTP status and JSON response shapes at the hosted routes are unchanged.
- **Safeguard:** The desktop bridge requires each caller to declare whether the hosted request actually uses platform user credentials. Hosted reads display the localized action and HTTP status without interpreting legacy response bodies; user-token operations keep their existing handling. Tests reproduced the false reconnect prompt and provider-body propagation before the fix. Batch status policy, retry limits, and user OAuth routes are unchanged.

### Round 17 — Use one source for native checkout revisions

- **Decision:** The runtime takes its expected GPUIX and GPUI revisions from the same `native/gpuix/source.json` that drives the builder. A static import embeds the revisions into compiled releases; installed applications do not need the checkout. The native API version, artifact manifest, cache identity, and validation rules are unchanged.
- **Safeguard:** Tests feed the parsed build pins into runtime validation and verify that a wrong GPUI revision is rejected both at startup and when staging an artifact from an alternate source directory. A compiled Linux resolver found the unchanged addon beside the executable with the checkout masked. The isolated `qa:native` fixture fails at `Missing tab-a` both before and after the change.

### Round 18 — Share native source verification between build and packaging

- **Decision:** `scripts/native-source.ts` owns source-manifest parsing, patch checksum verification, and the digest used by the builder and packager. The packager still checks application revisions before reading patches and validates artifact bytes, architecture, and manifest before staging. CI includes the shared module in the artifact cache key.
- **Safeguard:** The digest preserves the normalized manifest, host target, and raw patch bytes in manifest order. Compared against the previous implementation on all five supported targets; all digests match. The Linux addon staged with the original SHA-256, without rebuilding native code.

### Round 19 — Use one TypeScript expectation for the native ABI

- **Decision:** The builder, window capability guard, release smoke, and QA probes share `GPUIX_NATIVE_API_VERSION` from `native-runtime.ts`. The Rust addon still reports its implemented version independently; comparing that value with the application expectation detects mismatches across the boundary. The ABI remains version 3; the native source digest and artifact format are unchanged.
- **Safeguard:** The build cache schema checks the same ABI as the runtime, and CI hashes the module that defines it. Tests reject both older and newer versions. The Linux release and isolated packaged-runtime probe verified ABI 3 with the original addon bytes.

### Round 20 — Give the desktop runtime ownership of the dev listener

- **Decision:** Keep `/dev/inject-chat` and `/dev/hook` in a single dev-only listener with an idempotent stop. Explicit runtime disposal starts forced HTTP shutdown; HMR still reuses the runtime and reads the current debug hook on each request. Production startup and the close-to-tray path are unchanged.
- **Safeguard:** Loopback tests cover the existing response contract, hook replacement, port release, and suppression of a pending request that finishes parsing after disposal. An already-dispatched hook is not cancelled.

### Round 21 — Close the hosted WebSocket and its timers together

- **Decision:** `BackendConnection` owns the 30-second heartbeat alongside its socket and reconnect timer. Runtime disposal closes that connection; disconnect cancels both timers and detaches the actual EventTarget listeners before closing. Ordinary reconnect still uses the existing backoff and retains the 7TV, YouTube, and donation subscribers.
- **Safeguard:** Loopback tests check ping/pong delivery, one heartbeat per connection lifecycle, socket closure, and cancellation of a scheduled reconnect. HMR and close-to-tray do not call disposal. Message decoding and dispatch are unchanged.

### Round 22 — Await OBS overlay shutdown before process exit

- **Decision:** The desktop runtime retains the overlay listener and awaits its shutdown. The listener force-closes active OBS sockets and shares the same stop promise across repeated calls. Quit and existing QA callers await runtime disposal; HMR and close-to-tray still leave the listener running.
- **Safeguard:** A loopback test keeps an OBS socket open during shutdown, verifies the close frame, and rebinds the same port. Broadcasts, overlay URLs, and OAuth handling are unchanged.

### Round 23 — Bound the OAuth callback drain on exit

- **Decision:** Runtime disposal stops accepting OAuth callbacks and gives accepted callbacks up to two seconds to finish before stopping the transport. Track handler completion separately from sockets: closing the browser can release the socket before the handler has saved credentials. Keep dependent runtime services available during the grace period.
- **Safeguard:** On expiry, abort the listener's provider requests and check cancellation immediately before saving credentials or starting account follow-up. Already committed credentials are preserved. The account queue checks cancellation before selecting an account, starting reconnects, or publishing a change. Adapter operations and watched-channel fan-out already started before the deadline are not cancelled in this slice. Loopback tests cover a disconnected browser, an ignored-abort provider response, and port release. Twitch device sign-in and the one-shot listeners retain their existing lifecycle.

### Round 24 — Stop scheduling watched reconnects after OAuth cancellation

- **Decision:** Pass the OAuth cancellation signal through the account queue to watched reconnects. Stop taking new channels when cancelled and check again after waiting for a per-channel predecessor, after disconnect, and before refreshing the sender. Do not release the queue while an adapter operation is still running.
- **Safeguard:** Tests cover cancellation with four disconnects in flight, queued work behind a manual reconnect, and manual recovery afterward. Calls without a signal keep the existing concurrency and error aggregation. Adapter operations already in flight still own their completion.

### Round 25 — Retire stale startup connection completions

- **Decision:** The account-session service tracks startup attempts per platform without putting startup on the account queue. An account action retires its platform's attempt before disconnecting. Runtime disposal retires all startup attempts before the OAuth drain. Only an attempt that still matches the saved active account can subscribe its own channel to 7TV.
- **Safeguard:** Deferred fixtures cover completion while an account transition is still disconnecting, isolation between platforms, and disposal. The adapter operation itself is not cancelled. Startup does not inherit the manual reconnect status policy or change the existing startup failure logging.

### Round 26 — Retire YouTube connection attempts before publishing handles

- **Decision:** Reserve the adapter's connection revision before teardown yields. Disconnect or a newer connect can retire that revision before discovery starts. Clear the old session and relay handles before teardown callbacks; adopt a newly returned handle only while its revision is still current.
- **Safeguard:** Regressions reproduce same-turn disconnect before discovery, a retired attempt refreshing the replacement account, and disconnect during the relay's synchronous initial status. Authenticated gRPC and the anonymous hosted relay keep their existing transport contracts. This fixes the adapter boundary, not runtime-wide adapter disposal or shared gRPC retry timers.

### Round 27 — Retire YouTube retries when a status callback stops the session

- **Decision:** The shared gRPC session checks its retry epoch after notifying listeners and before arming the timer. A synchronous stop or stop-and-start retires that epoch. Desktop OAuth streams and hosted relays use the same rule; backoff, resume tokens, and immediate auth refresh are unchanged.
- **Safeguard:** Regression tests reproduce an extra credential read after stop and a stale retry superseding a replacement stream. The normal reconnect test still exercises cursor replay over loopback gRPC.

### Round 28 — Close watched adapters before their shared transports

- **Decision:** Runtime disposal retires the built-in watched manager after the OAuth grace period and before stopping the sender pool or hosted WebSocket. The manager reuses ordinary channel retirement, joins disconnects already in flight, and ignores new activation requests once disposal starts. The quit path also stops the layout-driven subscription controller; HMR and close-to-tray do not stop it.
- **Safeguard:** Deferred fixtures verify that shutdown cancels the remaining activation work, detaches listeners, releases 7TV ownership, coalesces disconnects, and leaves saved channels untouched. Plugin teardown and own-channel adapters retain their existing lifecycle in this slice.

### Round 29 — Stop own-channel adapters before shared resources

- **Decision:** After OAuth drains, the account-session service closes its queue and shuts down all registered own-channel adapters alongside the watched manager. It joins disconnects already in flight without waiting for connections or queued changes. Runtime disposal waits for both managers before closing the shared sender pool and hosted WebSocket.
- **Safeguard:** Deferred fixtures cover repeated disposal, cancellation of connection follow-up, and suppression of queued account changes. 7TV cleanup releases subscriptions by owner and canonical channel key, preserving watched co-owners. The legacy join/leave surface remains available while the runtime is live.

### Round 30 — Tie pending hosted 7TV subscriptions to the initiating socket

- **Decision:** The WebSocket registry is the authority for whether a pending request may commit. The 7TV manager stages provider results, then checks the initiating socket before updating the cache, registering live subscriptions, or sending a stale-cache fallback. A retired socket stops advancing its resubscribe batch. Already-committed subscriptions still follow the client identity during an overlapping reconnect; closing the current socket still cleans them up.
- **Safeguard:** Real loopback WebSocket tests pause a cache miss across both close-then-reconnect and overlapping replacement. They verify that no retired lookup is published, the old batch never starts its next lookup, and the replacement keeps its subscriptions. Same-socket unsubscribe during a lookup and shared subscription reference counts remain separate work.

### Round 31 — Retire pending 7TV work on unsubscribe

- **Decision:** The 7TV manager reserves each channel in a subscribe command before the first lookup. An unsubscribe or newer subscribe for the same client and channel retires that reservation. Single subscriptions and reconnect batches use the same path. The manager retains the existing socket check and does not serialize unrelated commands behind a provider request.
- **Safeguard:** Loopback tests cover retiring a lookup already in flight and an older batch entry not yet started, preserving unrelated entries and a subsequent subscribe. The wire protocol and committed subscription reference counts are unchanged.

### Rounds 32–33 — Make the hosted 7TV channel the unit of committed ownership

- **Decision:** A live channel owns its viewers and one emote snapshot. The set and user indexes point to live channel records; only the first/last channel changes an upstream subscription. The reverse client index serves disconnect cleanup; dispatch no longer scans all clients. A cached snapshot retains the 7TV user identity for a later rejoin.
- **Safeguard:** A set switch keeps the old subscription until a successful, current lookup commits. Lookup completion cannot overwrite a newer switch or a replaced channel. A new viewer still triggers refresh after expiry; an intervening update prevents an expired lookup from overwriting the live snapshot. Loopback and deferred provider fixtures cover partial detach, shared sets, cache rejoin, and overlapping switches.

### Hosted 7TV transport — Bound the wait for Hello

- **Decision:** An upgraded EventAPI socket must receive a valid Hello within ten seconds. Hello clears that socket's deadline and hands liveness over to the existing heartbeat watchdog. Malformed Hello and early heartbeat frames do not satisfy the deadline. A missed Hello uses the same jittered retry as a remote close; new subscriptions cannot bypass a scheduled retry.
- **Safeguard:** A loopback regression verifies that a malformed first session is retired without sending subscriptions, the next valid session restores the desired subscription exactly once, and an explicit connect does not skip the retry delay. Socket readiness reporting, the upstream and desktop message shapes, and reconnection without RESUME are unchanged. Backfill of missed events remains separate.

### Round 34 — Give EventAPI retries a single scheduler

- **Decision:** A remote close, a missing Hello, a heartbeat timeout, and an upstream reconnect opcode retire the socket through the same retry path. The existing jittered backoff is installed before disconnect notification; neither new demand nor a callback can open a second connection while the retry is pending. Desired subscriptions are unchanged and replay on a valid Hello.
- **Safeguard:** Isolated loopback cases verify the retry delay and one replay after both a heartbeat timeout and an upstream reconnect request. Existing close-code handling and the reset-on-Hello policy are unchanged. Backfill is not part of this transport change.

### Round 35 — Fence YouTube gRPC data continuations

- **Decision:** A stream keeps its existing epoch through each synchronous callback. If a status listener retires it, the data handler skips delivery; if a batch listener retires it, the old batch cannot stop a replacement or report a stale terminal status. Cursor capture still precedes callbacks so an immediate replacement resumes at the same boundary.
- **Safeguard:** Tests independently restart the session from each callback during a terminal batch and verify that the replacement uses the saved cursor and accepts data. The desktop chat benchmark injects normalized messages after the adapter/transport boundary and does not execute this stream handler. Adapter-level delivery within a normalized batch remains a separate investigation.

### Round 36 — Retire YouTube adapter delivery between batch items

- **Decision:** Both desktop YouTube transports pass their connection revision to the same delivery loop. A synchronous listener can retire the connection; the current item finishes notifying listeners, but subsequent messages, events, and moderation do not escape the old connection. The selected-account query still runs at batch entry, not between items.
- **Safeguard:** Relay and OAuth fixtures reconnect from the first message and verify that only the replacement can deliver the rest of a batch. The existing native chat benchmark injects messages after this adapter, so it does not exercise this change.

### Round 37 — Give Twitch fallback polling a terminal lifetime

- **Decision:** Backend disposal stops Twitch activity polling before awaiting other services. `stop()` permanently retires the active watches and queued refreshes; a late watch or account-triggered restart cannot revive them. The explicit capability query remains available and does not schedule polling.
- **Safeguard:** Deferred fixtures verify that stopping during the initial capability lookup suppresses publication, and stopping from a snapshot listener prevents the remaining notification and queued reads. EventSub shutdown and the final chat transcript flush remain separate work.

### Round 38 — Drain chat recording before graceful desktop exit

- **Decision:** The backend disposer awaits the existing SQLite and file-log flush after stopping its producers. It also attempts the flush if teardown fails, and reports a write error without turning it into an exit failure. The normal window/tray quit path already waits for backend disposal before calling `process.exit()`, which does not run the async `beforeExit` fallback.
- **Safeguard:** A headless subprocess boots the actual backend and exits explicitly after recording a final message. It verifies both persisted outputs and a clean exit with a warning if the file destination cannot be written. Updater-initiated exit and OS signals have separate lifetimes and are unchanged.

### Round 39 — Share the graceful desktop exit with updates

- **Decision:** An updater can launch the install helper only when the desktop composition has supplied an exit callback. The helper launch and restart arguments stay unchanged; after handoff, the owner requests normal window shutdown and waits for final session writes before disposing the backend. The normal quit and update paths share a single teardown and diagnostic flush.
- **Safeguard:** If window cleanup stalls, start backend disposal after five seconds; if shutdown itself stalls, stop waiting before the install helper's 60-second limit. Tests cover handoff order, duplicate exit requests, stalled windows, and teardown failures. The singleton wiring takes effect on a fresh process; restarting a pre-change development process is required.

### Round 40 — Retire Twitch EventSub account routing on shutdown

- **Decision:** Stop the account coordinator when backend disposal begins. Late watches and account refreshes cannot recreate clients. The coordinator retains channel ownership while existing transports emit their final AutoMod clears, then releases it. Individual transports remain restartable during normal operation.
- **Safeguard:** The regression verifies that shutdown closes the existing socket once and late commands neither read the active account nor create another connection.

### Round 41 — Skip retired personal-emote requests

- **Decision:** The provider runtime checks the same author-cache identity and lifetime before starting and after awaiting a personal-set read. Replaced or evicted work releases its concurrency slot without calling the provider. Reads already underway can settle, but cannot publish or change the retired entry's retry deadline.
- **Safeguard:** With all provider slots occupied, queue an old personal set and its replacement, then release the slots. Only the replacement reaches the provider. A synchronous subscriber reacting to a new author entry joins its pending read instead of issuing a duplicate.

### Round 42 — Give Twitch activity snapshots a runtime owner

- **Decision:** The desktop backend owns the one activity snapshot broker shared by UI reads and fallback polling. Disposal stops the poller, then retires broker admission and rejects queued snapshots and larger same-channel waiters. Already-started reads can settle; an existing subset still shares the active result. Credential preparation already underway can finish but cannot admit a retired snapshot.
- **Safeguard:** Tests hold an active read open during shutdown, verify that queued and larger requests reject immediately, and check both same-turn retirement and admission after credential preparation. The account-switch identity fence and the live concurrency limit are unchanged.

### Round 43 — Fence channel catalog warmup between provider stages

- **Decision:** A channel warmup checks its runtime lifetime after identity resolution, after native emote and badge reads, and before accepting catalog results or caching failures. A manual reload cannot continue into a new lifetime after waiting for another read or invalidating caches. Already-started provider calls can settle; stopping does not abort them.
- **Safeguard:** Deferred identity, native emote, and cache-invalidation fixtures stop and restart the runtime while each operation is pending. The retired work cannot start the next stage or publish. Concurrency limits and normal account/preference refresh behavior are unchanged. Audit the presence identity lookup and provider stop ordering separately; neither is changed by this slice.

### Round 44 — Retire provider refresh and presence at backend disposal entry

- **Decision:** Stop provider work before the first teardown await. Late channel, account, and preference refreshes cannot repopulate or publish retired state. Presence checks its revision before resolving the 7TV identity and before sending a heartbeat; changes to focus, account, or settings still invalidate it. The hosted socket stays open for adapter-owned 7TV unsubscriptions.
- **Safeguard:** Tests retire a presence pulse before warmup resumes and deliver late provider updates to a stopped runtime. Restart invalidates private catalogs if accounts changed while stopped, then applies saved preferences before serving cached emotes. Already-started calls may settle; activation and plugin teardown before backend disposal keep their existing order.

### Round 45 — Reconcile hosted 7TV catalogs after upstream reconnect

- **Decision:** After a replacement EventAPI session sends Hello, the subscription manager re-reads each retained channel's active set using its resolved platform identity. It uses the same snapshot commit and full-set message as live switches and expiry refreshes, without emitting synthetic chat notices. One batch runs at a time with up to three concurrent reads; a disconnect cancels its work.
- **Safeguard:** A loopback EventAPI test changes the upstream set while disconnected and verifies that an existing viewer receives the new snapshot and upstream subscriptions change. A delayed snapshot cannot overwrite a newer dispatch. Recovery is best effort: a revision conflict allows one retry within the same channel deadline. A failed or incomplete read, or a second conflict, leaves the current snapshot intact. Round 46 distinguishes confirmed absence from an incomplete read. Reconciliation does not wait for upstream subscription acknowledgements or claim gap-free replay.

### Round 46 — Clear confirmed inactive 7TV sets without dropping viewers

- **Decision:** Treat an explicit GraphQL `activeEmoteSet: null` for a known connection as a snapshot without a set ID, distinct from an empty identified set or an incomplete response. On a retained channel, publish an empty catalog through the existing wire message, release only the obsolete set interests, and keep viewers and the user interest for later activation. A channel without an active record or a cached snapshot still does not acquire a user interest for a missing set.
- **Safeguard:** The regression contrasts omission with explicit null, verifies the empty snapshot for existing and late viewers, ignores old-set events, and restores the catalog through the existing user-update path. Existing channel and revision checks apply to empty snapshots as well.

### Round 47 — Preserve the latest channel snapshot across overlapping joins

- **Decision:** While a channel has pending join lookups, retain its most recently detached record independently of cache expiry. A lookup may refresh its original revision, but cannot overwrite a newer detached record or revision. The record is released when the last lookup settles; this does not extend the cache TTL.
- **Safeguard:** A deferred join spans a channel replacement, the replacement's final detach, and cache cleanup. The waiting viewer receives the replacement catalog instead of the stale provider response.

### Round 48 — Keep one owner for a pending 7TV set switch

- **Decision:** A pending switch carries its target and serves as its own identity fence. Repeated events for that target leave the existing lookup and revision untouched. A different target still supersedes the request, including a return to the currently active set.
- **Safeguard:** A duplicate cannot discard a successful lookup by starting a second read that fails. An older response for a superseded target cannot publish even if a later switch names the same target again.

### Round 49 — Make the hosted 7TV GraphQL client the sole operation owner

- **Decision:** Both runtime operations share one catalog field selection and one response decoder. Keep the operation names, variables, and null/omission behavior. Remove the unused parallel SDL, query copies, generated types, and codegen dependencies rather than adding generation or sidecar files to the build.
- **Safeguard:** The client contract test checks the two request envelopes and rejects an incomplete catalog on either path. The production binary still bundles the client without loading query files at runtime.

## Next investigations

| Priority | Area                                | Evidence and next slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Dependencies and CI                 | The bridge is independent of presentation modules and has a limited consumer contract. Evaluate splitting feature capability groups in `DesktopApi` only where it reduces coupling without changing callers' behavior.                                                                                                                                                                                                                                                                               |
| High     | Hosted credentials, retries, caches | Characterize desktop-to-host authentication separately from platform user OAuth on command routes. Decide how to report unavailable platform data before changing partial batch behavior.                                                                                                                                                                                                                                                                                                            |
| High     | Desktop runtime lifetime            | Desktop listeners and the hosted WebSocket stop on disposal. Both built-in adapter groups stop before shared resources. Audit remaining non-adapter background work separately. Hosted 7TV now has channel-owned subscriptions; investigate reconnect backfill separately. Audit batch delivery interrupted by synchronous disconnect and the remaining direct join/leave entry points. Do not treat a process-level shutdown hook as permission to reboot the singleton after HMR or close-to-tray. |
| High     | Desktop state and presentation      | `gpuix/state/app.ts` mixes backend event projection, chat buffers, and status polling; `gpuix/backend/api.ts` mixes several feature responsibilities. Keep the external seam and isolate one feature at a time. Use existing hot-path baselines before changing stores or ingestion. Audit overlapping UI primitives against actual GPUIX behavior before consolidating them.                                                                                                                        |
| Medium   | Data, API and compatibility         | Map which current and legacy clients own Kick account and OAuth routes, and which readers need the current SQLite settings/history formats. Keep independent single-channel and batch status error contracts while consolidating only equivalent provider calls. Characterize backend HTTP/WS authentication differences before any change.                                                                                                                                                          |
| Medium   | Config, tooling and observability   | Reconcile environment docs against parsers and deployment templates. Inventory retry and log policies before adding generic infrastructure.                                                                                                                                                                                                                                                                                                                                                          |
| Medium   | Docs and developer onboarding       | Root/package `AGENTS.md` and the GPUIX README still contain older runtime, package, and test descriptions. Link to canonical source for architecture, release scripts and generated contracts instead of copying implementation inventories into multiple guides.                                                                                                                                                                                                                                    |

## Awaiting a product or compatibility decision

- Removing legacy hosted Kick OAuth/account endpoints or old profile formats is out of scope until their supported client and upgrade windows are explicit. No removal is assumed by the refactor.
- Existing plugins are supported by the current runtime. Lua compatibility and new plugin capabilities are separate scope; neither is required to simplify ownership of the existing runtime.
