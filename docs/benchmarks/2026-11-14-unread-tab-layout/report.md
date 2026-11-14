# Unread badges and channel tab layout

Native GUI QA verified that unread and mention badges can appear, change, and clear without
moving tabs or the Add button. The production fixture ran at 248–900 px and included a
470 px case where the former inline badge would force the live tab onto another row.
Pointer and keyboard selection, exact-count tooltips, and long labels passed. The drag
fixture also passed cross-row reordering and cancellation while processing 476 chat messages,
with zero fresh geometry queries during drag.

## Chat workload

The default development matrix completed all 15 scenarios. The production runs used 50
channels, four panes, 200 retained messages per channel, and 5,000 offered messages/s for
30 seconds after a 3-second warmup. All runs used Bun 1.4.4, a 1200×800 window, isolated
headless Weston, and a Ryzen 7 9800X3D. The harness verified the loaded React mode and
mounted `ChatView` directly. The native GUI fixture above measured the tab layout.

| Production run | Processed msg/s | CPU % of one core | RSS median MiB | RSS peak MiB | JS heap peak MiB | Event-loop lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 4997.65 | 43.12 | 372.34 | 457.36 | 156.34 | 3.25 |
| After 1 | 4988.01 | 41.94 | 376.90 | 457.82 | 131.77 | 3.39 |
| After 2 | 4988.51 | 41.56 | 380.16 | 458.11 | 140.60 | 3.03 |
| After 3 | 4989.68 | 41.57 | 366.23 | 433.32 | 139.45 | 3.30 |
| After median | 4988.51 | 41.57 | 376.90 | 457.82 | 139.45 | 3.30 |

All three runs processed at least 99.7% of the offered rate. The median CPU changed by
−3.6%, median RSS by +1.2%, and median peak RSS by +0.1% against the baseline.

## Provenance

- Before `36c3c670e6127b4b366229b598f114c8f093050a`, runtime SHA-256 `347db6a135234d74d0e0ee950c456f7feb0d20c64f6e9d609bf60bacb821bc12`.
- After `c64cc7300852365db7b6f9e06567bd27e5e6109f`, runtime SHA-256 `337e7852d53a557395f0f6be4e8c17106b7321abd02492ecd5593bdeedb1d41f`.
- Linux x64 native `0.11.0-twirchat.27`, API 3, patch digest `14284b5e45d28bee`, SHA-256 `ae97bab7d71bb610e4fb93aa7cccdf247d9d88f8b9495fdc5ed25fa961d93b22` for both revisions.

```sh
bun run --cwd packages/desktop qa:gui --node-env production --keep --timeout 150 -- bun scripts/qa-tab-counts.tsx
bun run --cwd packages/desktop qa:gui --dbus --keep --timeout 70 -- bun scripts/qa-drag-interactions.tsx
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```
