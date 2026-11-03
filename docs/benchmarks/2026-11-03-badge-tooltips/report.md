# Badge hover tooltips (#80)

Platform and cosmetic badges show their label, source and available description on hover.
The popup mounts after 300 ms, stays inside the window, and scrolls long descriptions.
Twitch titles/descriptions survive live normalization, imported history and SQLite reloads;
older image-only backend responses remain supported. Hover adds no metadata requests.

## Performance scope and reused evidence

The completed default matrix and production repetitions remain in
[the interaction report](../2026-11-03-interactions/report.md), with their original source/native
provenance. They are historical evidence for the existing workload, not measurements of this
feature's final tree or its extra per-badge cost.

The default workload creates normalized Kick messages with empty badge arrays, disables
provider cosmetics, and uses compact mode. That mode skips BadgeList entirely for empty arrays;
no BadgeTooltip mounts. Direct event injection bypasses Twitch catalog/history/persistence
parsing. Tooltip text formatting and the viewport subscription mount only while a popup is open.
This narrow feature is outside that measured steady-state workload, so the AGENTS.md reuse
exception applies; repeating the badge-free matrix would not measure tooltip overhead.
Module/schema initialization can still affect startup allocations. No claim of identical startup
memory or a badge-rich maximum sustainable rate is made.

Three initial production baseline repetitions were preserved before editing: 50 channels,
four panes, 5000 total messages/s, 200 retained messages/channel, 1200x800 window, three-second
warmup, 30-second measurement, two-second drain. React/JSX/reconciler production mode was
verified by the harness, with private headless Weston displays. No GC/retention/refresh-rate
changes were made. These are baseline-only shared-host observations, not a before/after
comparison; other chats were working on the same project during this session.

| Run | Actual msg/s | CPU % of one core | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4996.4 | 112.5 | 511.1 | 615.5 | 218.1 | 2.63 |
| 2 | 4995.8 | 112.3 | 509.8 | 616.0 | 216.1 | 3.07 |
| 3 | 4996.3 | 111.2 | 514.1 | 595.3 | 233.0 | 2.83 |

Medians (ranges): CPU **112.3% (111.2-112.5%)**, RSS median **511.1 MiB (509.8-514.1)**,
RSS peak **615.5 MiB (595.3-616.0)**, JS heap peak **218.1 MiB (216.1-233.0)**,
lag p95 **2.83 ms (2.63-3.07)**. All preserved over 99% of the offered rate. The coupled
in-process generator does not prove maximum external throughput.

Baseline source: clean commit `82552a53694517829df7500d6c4b96e44f87dd27`, runtime SHA-256
`39e798c3f11aa658cb845a7cc02dd04b24e38530c130ca716125f2b726154676` (352 files).
The native manifest recorded before the later rebuild was API 3, `0.11.0-twirchat.3`,
patch digest `ad7fc24cef2eaf2f`, SHA-256
`cd10c5ab9042a0ef0c485c3b320f7862128b78e6809fba8aa4181ad1a379d248`.

Raw results, samples and isolation evidence: [baseline 1](baseline-1/results.json),
[baseline 2](baseline-2/results.json), [baseline 3](baseline-3/results.json).

## Functional validation

`bun run fix`, `bun run check` and `bun run test` passed in an isolated checkout containing
only #80. Test totals: 1153 passed, 15 PostgreSQL integration tests skipped. Existing lint
warnings remain; there are no lint/type/format errors.

The native fixture uses actual pointer movement inside the isolated launcher, never a host
desktop window. It covers compact/modern layouts at 420x300 and 900x600; image, embedded SVG,
text and 7TV/BTTV/FFZ badges; long unbroken metadata at the edge; Escape, focus/blur, rapid
cancel, unmount/remount, user profile badges, and ongoing ChatView traffic. Native text leaves
need both pointer-hit suppression and selection suppression so they do not intercept hover.

The focused fixture is functional evidence, not a CPU/RSS benchmark: its timing includes
synchronous automation, screenshots and unrelated host build activity. Badge-rich resource
overhead is not quantified by the badge-free benchmark.

Final production fixture: [result](qa/badge-tooltips-result.json),
[isolation proof](qa/isolation.json), [native artifact](qa/native-artifact.json).
It painted 238 incoming badge-bearing messages with 238 heartbeat ticks;
there were 2 cosmetics loads (chat and profile), with none caused by hover.
The recorded maximum lag was 63.64 ms, including synchronous automation.
The final fixture also covers a profile badge without an image.

Native artifact built from this branch's unchanged manifest: API 3,
`0.11.0-twirchat.3`, patch digest `ad7fc24cef2eaf2f`, SHA-256
`3aaa4bcbee9c16e01cf5f87f85e12de5b36fa7bcb4ce661f9179c66d07b181c8`. No native source or patches are changed by #80.

Screenshots: [compact 420](qa/badges-compact-420.png), [modern 420](qa/badges-modern-420.png),
[compact 900](qa/badges-compact-900.png), [modern 900](qa/badges-modern-900.png),
[long description at the edge](qa/badges-edge-modern-420.png).

## Verification after main advanced

The feature was rebased onto `855cf03` (announcement rendering and case-sensitive 7TV matching).
The TypeScript fixture list retains both announcement and badge checks. `bun run fix`,
`bun run check` and all tests passed again: **1163 passed, 15 PostgreSQL tests skipped**.
The full isolated production badge fixture passed again with the rebased ChatMessage:
[production result](qa/rebased-production-result.json). Previous screenshots and source
provenance remain the explicitly recorded pre-rebase captures above.
