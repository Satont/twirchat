# Stable tab counters and retained-row paint regression

Viewer/unread counts have fixed, right-aligned rails. Watched tabs keep their viewer rail during
offline/unknown states; the live dot keeps its footprint. Exact counts remain available in a
tooltip, while compact counts retain the existing K/M format and bounded larger units.

[Native geometry verification](tab-counts-result.json) passed all 24 states: 12 counter/active/
offline combinations at 900 and 420 px, with invariant sibling positions and widths. Long labels
and horizontal scrolling are covered. This final run uses the four-pixel gap between count rails.

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
