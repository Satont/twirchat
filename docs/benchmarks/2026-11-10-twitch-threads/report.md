# Twitch reply thread performance

The three production repetitions sustained 4,987–4,990 messages/s at a target of 5,000.
Against the three baseline runs, median CPU was 49.92% → 47.46%, median RSS was
370.98 → 368.31 MiB, and median peak RSS was 473.10 → 451.37 MiB. The refreshed
baseline measured 4,991 messages/s with CPU and RSS close to the feature runs.
The peak JS heap varied across runs, including 179.88 MiB in the refreshed baseline.

## Reproduction

```sh
bun run --cwd packages/desktop bench:chat
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode development
bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30
```

- Ryzen 7 9800X3D, 16 logical CPUs, Radeon RX 7800 XT, Linux 7.3.1-1-cachyos, Bun 1.4.4.
  Private headless Weston GL, 1200×800, three-second warmup, and two-second drain.
  The production target uses 50 channels, four panes and 200 retained messages per channel.
  CPU 100% represents one logical core.
- Baseline revision `de2a2004060690d2036af98b957f288f68d9f079`. The refreshed
  baseline `a669df02b83db63616adc140ceddc24d0a8354d1` has the same
  runtime SHA-256 `4aea52233765c9ce038f60266ca590516d36814141c2ea340c28091497270e07` (549 files).
- Feature revision `cc22781785d454ce68d76467c56e3ef83a9b3a5b`. The initial
  matrix revision `48d48ed071778aee8682c1c28959c8f9e3523424` has the same
  runtime SHA-256 `9dae3f88e0c1fcfeeb3c07d415af78614c2f4a87795ad71998f11a0a1b7e5136` (551 files).
- Native `0.11.0-twirchat.25`, API 3, patch digest `f6ff95b61fce09c8`.
  Binary SHA-256 `ce789deb4d66695747865d79691dfd2400034bb7d5350c177255bdaf83ec4819`.

The benchmark uses generated chat, measures the ordinary closed-panel path, and verifies
the loaded React mode. Production cases recorded zero React User Timing entries.
The coupled generator can miss scheduled messages under host contention.

## Production target

| Run | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Baseline 1 | 4988.68 | 48.45 | 370.98 | 483.40 | 168.62 | 5.80 |
| Baseline 2 | 4992.94 | 50.69 | 367.02 | 453.14 | 154.77 | 5.76 |
| Baseline 3 | 4989.31 | 49.92 | 379.06 | 473.10 | 163.57 | 4.99 |
| Baseline median | 4989.31 | 49.92 | 370.98 | 473.10 | 163.57 | 5.76 |
| Baseline range | 4988.68–4992.94 | 48.45–50.69 | 367.02–379.06 | 453.14–483.40 | 154.77–168.62 | 4.99–5.80 |
| Refreshed baseline | 4990.88 | 48.10 | 372.32 | 455.05 | 179.88 | 4.74 |
| Feature 1 | 4988.21 | 48.73 | 368.31 | 455.16 | 172.12 | 5.20 |
| Feature 2 | 4987.38 | 47.42 | 369.11 | 451.37 | 180.33 | 5.23 |
| Feature 3 | 4990.41 | 47.46 | 363.98 | 444.84 | 168.81 | 4.82 |
| Feature median | 4988.21 | 47.46 | 368.31 | 451.37 | 172.12 | 5.20 |
| Feature range | 4987.38–4990.41 | 47.42–48.73 | 363.98–369.11 | 444.84–455.16 | 168.81–180.33 | 4.82–5.23 |

The first feature measurements overlapped unrelated build and test activity on the host.
The generator missed 1,602, 13,431, and 20,895 scheduled messages in the three production
runs. All generated messages were processed after drain. The runs reached 4,943, 4,549,
and 4,287 messages/s and were excluded from the quiet-host comparison above.

## Development

All 15 default scenarios completed. The first 50-channel, four-pane target run coincided
with host contention and missed 4,038 scheduled messages. A repeat during lower host load
used the same 1200×800 setup and measured 4,988 messages/s on the base and 4,987 on the branch.

| Run | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Matched baseline target | 4987.59 | 63.46 | 554.36 | 689.86 | 164.48 | 13.01 |
| Matched feature target | 4987.11 | 64.33 | 558.54 | 654.29 | 161.30 | 13.64 |

### Default matrix

| Run | Actual msg/s | CPU % | RSS median MiB | RSS peak MiB | JS heap peak MiB | Lag p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| c1-r0-p1 | 0.00 | 1.13 | 236.22 | 236.74 | 53.87 | 0.06 |
| c1-r100-p1 | 99.83 | 27.09 | 365.19 | 433.12 | 116.55 | 1.88 |
| c1-r1000-p1 | 993.90 | 53.40 | 416.14 | 499.31 | 172.99 | 9.30 |
| c1-r5000-p1 | 4984.62 | 42.68 | 400.01 | 501.18 | 169.40 | 6.41 |
| c10-r0-p1 | 0.00 | 1.67 | 241.98 | 243.30 | 55.67 | 0.60 |
| c10-r100-p1 | 99.42 | 22.05 | 302.08 | 325.50 | 79.05 | 2.94 |
| c10-r1000-p1 | 997.74 | 30.03 | 367.73 | 441.58 | 131.56 | 2.80 |
| c10-r5000-p1 | 4906.43 | 56.27 | 419.34 | 501.96 | 171.85 | 28.88 |
| c50-r0-p1 | 0.00 | 1.99 | 251.42 | 252.36 | 62.09 | 1.75 |
| c50-r100-p1 | 99.33 | 9.63 | 264.48 | 270.61 | 68.61 | 3.50 |
| c50-r1000-p1 | 998.15 | 30.10 | 353.38 | 407.30 | 114.56 | 2.37 |
| c50-r5000-p1 | 4971.72 | 46.46 | 400.04 | 500.36 | 171.22 | 9.97 |
| c50-r1000-p4 | 988.50 | 67.81 | 514.13 | 606.49 | 169.08 | 95.89 |
| c50-r5000-p4 | 4646.76 | 101.16 | 547.62 | 646.22 | 159.46 | 51.93 |
| c100-r5000-p4 | 4976.14 | 86.53 | 538.69 | 606.79 | 148.42 | 25.43 |

## Native interaction check

```sh
bun run --cwd packages/desktop qa:gui --dbus --keep --timeout 30 -- bun scripts/qa-chat-thread.tsx
```

Passed at normal and small window sizes with native pointer and keyboard input. The fixture
covers both themes, wheel scrolling with live replies, dismissal via Escape and the close
button, and sending a preserved draft to the root with the selected account.
