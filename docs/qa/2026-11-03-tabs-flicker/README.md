# Compact tab counters and retained-row paint regression

Viewer/unread counts remain visible together, with compact sans-serif numerals and a small
unread pill. Missing viewers and zero unread reserve no empty cells. Exact counts remain in
the tooltip. Compact viewer labels preserve `61.5K` and stay within five characters, including
rounding boundaries such as `99.95K`.

[Compact native verification](compact-tab-counts-result.json) passed 24 within-mode numeric
checks at 900/420 px and a representative mixed state: home 11 viewers/22 unread, Satont one
viewer, empty xqc, and caseoh 62.2K viewers/99+ unread. Both numbers stay visible. Empty xqc is
66 px wide; Satont with one viewer is 107 px. Long labels and horizontal scrolling are covered.
The parent visually reviewed the narrow and normal screenshots.

Plain count changes (9/10/99/999), decimal K labels and mention counts are stable within their
representations. A counter appearing/disappearing or changing representation may resize its tab;
the design deliberately avoids permanent empty rails to reserve every possible state.

The [original fixed-rail verification](tab-counts-result.json) belongs to `e8aabfb` and remains
historical. Its permanent 36/28 px slots were rejected visually and replaced by this compact
layout; passing geometry checks alone did not establish acceptable design quality.

The native virtual list previously compared a captured row ID to the current child at its old
index. One eviction/append between root rendering and deferred row painting shifts all surviving
indices, causing every visible row to return an empty placeholder for that frame. The fix checks
the expected child's retained parent in O(1), preserving the selected frame's row/focus identity.
Truly removed, detached or reparented rows still return placeholders.

Five deterministic Rust tests force the stale-entry/new-tree gap: retention splice, prepend/
reorder, current text, destruction/reparenting and detached/missing parents. The retention test
shows all 30 old index checks failing while all surviving parent checks remain valid.

[Private GUI verification](deferred-chat-rows-result.json) used 200 retained rows and eight
controlled appends, with 380 cached-paint samples, zero blank-chat samples and preserved native
focus. This checks integration; the Rust tests force the exact race. Source-reload root remounts
are a separate development path and are not exercised as normal incoming-message updates.

- Native API 3, patch digest `ad7fc24cef2eaf2f`, 56,166,296-byte release artifact.
- SHA-256 `cd10c5ab9042a0ef0c485c3b320f7862128b78e6809fba8aa4181ad1a379d248`.
- Locked release build and five targeted Rust regressions passed.
- Final workspace fix/check passed, including strict types for both native QA scripts.
- **1134 Bun tests passed**, 15 PostgreSQL integration tests skipped.
- All windows/screenshots used isolated virtual displays; no host workspace was touched.
- The user deferred load testing. No resource benchmark was completed for these fixes and no
  CPU/RSS/throughput improvement is claimed. Restart the desktop to load the updated native addon.
