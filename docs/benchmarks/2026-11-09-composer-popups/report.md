# Command completion and emote picker

Native input QA reached and selected commands beyond row 15 at 420×300 and 900×600
with incoming chat. It verified wraparound, clipping, Escape, and insertion of
`!quote add` followed by sending with an argument. Picker QA at 820×850 and 320×240
verified provider tabs, search, all seven columns, paging, scrolling to the final
emote, clicking to select, and dismissal.
An additional production QA run used 500 numbered entries per command catalog and
verified that arrow navigation reached the final numbered Twir and slash commands.

## Production target

Each run used a fresh 1200×800 Weston window and private profile. The workload offered
5,000 messages/s across 50 channels and four panes, with 200 messages retained per
channel. It warmed up for three seconds, measured for 30 seconds, and drained for two.
CPU 100% represents one logical core. Memory is in MiB.

| Run | Processed msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4986.0 | 45.0 | 360.4 | 445.9 | 151.3 | 4.70 |
| Candidate 1 | 4994.3 | 48.4 | 372.6 | 442.8 | 158.8 | 5.57 |
| Candidate 2 | 4989.6 | 46.5 | 355.7 | 414.1 | 145.4 | 4.35 |
| Candidate 3 | 4994.2 | 45.6 | 361.3 | 455.4 | 170.0 | 4.32 |
| Candidate median | 4994.2 | 46.5 | 361.3 | 442.8 | 158.8 | 4.35 |

Candidate medians changed by +3.5% in CPU, +0.2% in RSS median and −0.7% in RSS peak
against the single baseline. The lowest production rate was 99.79% of offered traffic.
The benchmark uses the in-process generator and measures the chat with its popups closed.
The native interaction tests exercise the open menus separately.

## Development matrix

All 15 default cases completed. Measurements lasted 12 seconds after a three-second
warmup. These runs used development React. The production runs above used production
React. The benchmark verified the loaded React, JSX runtime and reconciler in each case.

| Channels | Panes | Offered msg/s | Processed msg/s | CPU % | RSS median | RSS peak | JS heap peak | Lag p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0.0 | 1.1 | 236.4 | 237.1 | 51.7 | 0.06 |
| 1 | 1 | 100 | 99.7 | 24.8 | 371.2 | 433.8 | 113.3 | 1.75 |
| 1 | 1 | 1000 | 995.0 | 33.3 | 416.4 | 499.9 | 168.0 | 3.86 |
| 1 | 1 | 5000 | 4976.9 | 37.7 | 402.1 | 479.3 | 157.5 | 4.52 |
| 10 | 1 | 0 | 0.0 | 1.0 | 244.3 | 245.0 | 53.3 | 0.06 |
| 10 | 1 | 100 | 99.6 | 15.1 | 297.4 | 324.9 | 76.8 | 0.57 |
| 10 | 1 | 1000 | 997.5 | 24.3 | 375.8 | 446.5 | 130.9 | 0.81 |
| 10 | 1 | 5000 | 4978.9 | 32.6 | 385.4 | 502.9 | 178.1 | 3.50 |
| 50 | 1 | 0 | 0.0 | 1.1 | 255.3 | 256.0 | 59.8 | 0.07 |
| 50 | 1 | 100 | 99.7 | 5.3 | 268.5 | 276.0 | 65.8 | 0.07 |
| 50 | 1 | 1000 | 997.9 | 23.0 | 351.5 | 398.4 | 112.4 | 1.49 |
| 50 | 1 | 5000 | 4993.5 | 28.6 | 382.6 | 471.7 | 153.9 | 2.19 |
| 50 | 4 | 1000 | 996.0 | 50.0 | 530.4 | 620.6 | 157.2 | 9.36 |
| 50 | 4 | 5000 | 4989.2 | 61.7 | 523.8 | 616.2 | 146.2 | 13.12 |
| 100 | 4 | 5000 | 4988.6 | 53.8 | 505.1 | 584.0 | 153.3 | 9.17 |

## Reproduction

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

- AMD Ryzen 7 9800X3D, Linux 7.3.1-1-cachyos, Bun 1.4.4.
- Native GPUIX `0.11.0-twirchat.24`, API 3, patch digest `74ae2d4f71fc9b59`,
  SHA-256 `71327b75a3411066aae09f0cdaa1849b1f80df283910a68cc81e1623ddad0afc`.
- Baseline commit `561bf02d8009f2ca6cfdbea96986bbb1c4733e71`, clean tree, runtime inputs
  SHA-256 `c47fb7a5ba2489631dbbbe8801b8206a2b21cb11cc98d149cf3c9991ffdcb2b4`.
- Candidate uses the same commit plus worktree diff SHA-256
  `797a775aab37899fa0c0e477b1dd7ce0cbb5bc538b0eafcaeca0f41c68dbc928`, runtime inputs
  SHA-256 `3844950cc96287cf1f4eb55b2291dfbed00cd90bb31a06c48ad974d514c6c841`.
