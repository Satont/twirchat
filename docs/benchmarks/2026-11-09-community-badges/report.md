# Community badges and cosmetic toggles performance gate

The cosmetic resolver now supports FFZ:AP, DankChat, Chatsen, Homies Custom and Twir badges. Each source has a persisted switch; the existing provider-badge and 7TV-paint switches also apply in user cards. Bulk catalogs are indexed once per cached payload and are not fetched for disabled sources. The message-ingestion path and native runtime are unchanged.

## Production target comparison

Three fresh 30-second runs per version used 50 channels, four panes, 5,000 offered messages/s and 200 retained messages per channel. The workload is text-only compact chat with avatars and provider cosmetics disabled, so it checks the shared rendering/store path rather than downloading badge catalogs. CPU 100% is one logical core; memory is MiB.

| Version | Run | Actual msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 1 | 4998.1 | 47.3 | 365.9 | 493.4 | 178.2 | 4.60 |
| Baseline | 2 | 4987.0 | 48.1 | 360.3 | 454.1 | 161.9 | 5.09 |
| Baseline | 3 | 4997.6 | 48.5 | 360.9 | 467.9 | 170.4 | 5.34 |
| Candidate | 1 | 4987.3 | 50.3 | 364.8 | 452.2 | 163.4 | 4.91 |
| Candidate | 2 | 4995.4 | 48.3 | 379.2 | 468.2 | 165.8 | 5.21 |
| Candidate | 3 | 4993.4 | 47.5 | 372.3 | 475.1 | 172.9 | 5.16 |

Medians (ranges):

| Version | Actual msg/s | CPU % | RSS median | RSS peak | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4997.6 (4987.0–4998.1) | 48.1 (47.3–48.5) | 360.9 (360.3–365.9) | 467.9 (454.1–493.4) | 5.09 (4.60–5.34) |
| Candidate | 4993.4 (4987.3–4995.4) | 48.3 (47.5–50.3) | 372.3 (364.8–379.2) | 468.2 (452.2–475.1) | 5.16 (4.91–5.21) |

Median CPU changed by **+0.44%**, median RSS by **+3.18%**, and median peak RSS by **+0.07%**. All candidate runs preserved at least **99.74%** of the offered rate. There is no repeated CPU/RSS regression above the project's 5% investigation threshold. These short shared-host samples do not establish a performance improvement.

Raw per-run samples and provenance: [baseline 1](production/baseline-1/results.json), [baseline 2](production/baseline-2/results.json), [baseline 3](production/baseline-3/results.json), [candidate 1](production/candidate-1/results.json), [candidate 2](production/candidate-2/results.json), [candidate 3](production/candidate-3/results.json).

## Development matrix

The complete default 15-case matrix completed with a 1200×800 window, three-second warmup, 12-second measurement and two-second drain. Every case completed without hitting the RSS limit. The four-pane target processed **4977.5 msg/s** at **58.1% CPU**, with **555.9 MiB median RSS**, **685.8 MiB peak RSS**, **162.4 MiB peak JS heap** and **11.99 ms lag p95**. Its actual rate was 99.55% of offered load.

[Full matrix report](development/report.md) · [results.json](development/results.json) · [results.csv](development/results.csv)

Development and production numbers are separate execution modes and are not compared as algorithmic improvements.

## Provenance and reproduction

```sh
bun run --cwd packages/desktop bench:chat --output /tmp/opencode/bench-community/development
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30 --output /tmp/opencode/bench-community/candidate-1
```

- Baseline: clean `bdb8e7d31897dac8444765a9184f4f305f1cb41c`, runtime input SHA-256 `4deaf7925662fcb039b35c98d5c00e3c017c3635fd066d848358c3f3903752d0`.
- Candidate: the same parent plus the community-cosmetics diff, dirty diff SHA-256 `842a890bdd2233ca46052e98cf36a8c8b197bd7085788e7da98c0e872c1985a5`, runtime input SHA-256 `5f11de0df736e86071ae97bcb126b406f4ea7b0a1a065416e7fbb3813962aee4` (455 files).
- Both used the identical native artifact SHA-256 `a9480a2fd0f30ab4ef66bd5bf2af04a6b2e2c84ce3d41198d1464e4a78018874`, Bun 1.4.4 and hardware-backed private Weston. Sources/native bytes were frozen during each measurement; no concurrent build, test, profiler or second application instance ran.
- No messages were dropped to improve results. Retention, refresh behavior, React mode and measurement windows were unchanged. No forced GC, allocator changes or performance-entry clearing was used.

After these measurements, the feature was rebased onto `6de20f4` to include six unrelated upstream commits. The only conflict was the `cosmetics.ts` import list; the ChatYX paint renderer and preference-aware resolver were both preserved. The raw measurements intentionally retain the original baseline/candidate provenance above. Full workspace checks/tests and focused GUI QA were rerun on the rebased tree.

## Functional evidence

- Unit tests cover the five payload adapters, source selection/priority, independent preference persistence, disabled-fetch behavior, failure isolation, relay allowlists, and badge/paint-aware cosmetic cache keys.
- Isolated GPUIX settings QA saves all five source switches plus the global badge/paint switches. Badge-tooltip QA covers every new source label and user-card badge toggling. Mention/user-card QA verifies enabled paints and that disabling paints hides the card paint and skips its cosmetics fetch.
- A live public-API smoke loaded all five catalogs without provider errors. Twitch user `244902384` received both `Twir Contributor` and `Twir Translator`, confirming multiple Twir badges per user and the `s3.twir.app` SVG mapping.
