# Twitch history and provider relay verification

External Twitch history is fetched through the configured backend, merged by original Twitch ID
and normalized channel, and integrated into initial/reconnected chat, channel/user logs, filters
and exports. Existing live/local payloads take priority. Historical snapshots do not emit live
chat notifications, activity counters or OBS replay. Distinct IDs with equal text remain distinct.

7TV/FFZ/BTTV metadata and artwork requests use the backend relay, including old stored source
URLs, native image cache, paint layers/worker and OBS payloads. Source formats/animation and
existing disk-cache identities are preserved. Provider configuration and limits are described in
the [backend README](../../../packages/backend/README.md#external-twitch-message-history).

## Checks

- `bun run fix`, `bun run check`: passed; existing lint warnings, no errors.
- Final integrated `bun run test`: **1134 passed**, 15 PostgreSQL integration tests skipped.
- Backend tests cover overlapping providers, canonical IDs, deleted-message tombstones,
  equal-time cursor ties, user/date/literal-text queries, bounded archive scans, source failures,
  timeouts, configuration, relay allowlists, formats, cache/concurrency limits and auth isolation.
- Desktop tests cover IRC/CTCP/emote/reply/badge normalization, local-authoritative insert-ignore,
  live arrivals during backfill, opt-out, provider failures, history/export pagination, isolated
  export databases, home/watched snapshots and preservation of distinct channel identities.
  Global query merge memory is bounded to 1000 candidates while fetched channel history remains
  available in SQLite; existing local payloads are resolved before applying remote text filters.
- A real Sharp worker fetched its paint layer through a local backend fixture. OBS serialization
  preserves original message objects while rewriting provider asset URLs.
- [Native history UI](history-logs-result.json) passed at 900/420 px: real paging, duplicate/race
  handling, stale user switches, partial-source hints, keyboard opt-out persistence and actual
  GIF pixels (934 changed pixels inside its artwork slot).
- [Complete production App](app-production.json) and [eight-stage HMR](hmr.json) passed.
  Native GUI and screenshots used only private isolated displays.

The user deferred load testing. The newly started resource run was terminated before completion;
its incomplete output is excluded. No new CPU/RSS/throughput claim is made for these changes.
The previous [performance evidence](../../benchmarks/2026-11-03-interactions/report.md) remains
historical, with its own exact source provenance.

The backend and desktop changes must be deployed together. No running backend or user app was
restarted during verification. History availability remains limited by provider retention,
coverage and opt-outs; partial results stay explicit while local logs remain readable.
