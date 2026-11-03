# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: development, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit 27f1c9f4e1abd52c9c26223d6a7b8b3af2c8a780; dirty tree SHA-256 5eeec964c0697db72d224027387fbe5669fbf2492a1e94ec817356ad8e48d1e8; runtime inputs SHA-256 e167f953b55eba0cae8be14e1eda300cd9d73d8f55fe192fba230dd2bb3480ec (338 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.2 | 0.0 | 283.4 | 284.1 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.7 | 56.0 | 1.0 | 471.9 | 568.1 | 80.6 | 2.4 | completed |
| 1 | 1 | 1000 | 996.7 | 86.4 | 1.1 | 562.3 | 694.9 | 80.6 | 4.7 | completed |
| 1 | 1 | 5000 | 4962.8 | 133.6 | 0.9 | 614.3 | 776.4 | 80.6 | 24.8 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 280.1 | 280.7 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 21.3 | 0.3 | 346.1 | 372.2 | 80.6 | 0.8 | completed |
| 10 | 1 | 1000 | 997.7 | 59.8 | 0.9 | 467.4 | 566.0 | 80.6 | 1.9 | completed |
| 10 | 1 | 5000 | 4986.3 | 74.5 | 1.0 | 511.2 | 641.7 | 80.6 | 4.7 | completed |
| 50 | 1 | 0 | 0.0 | 1.2 | 0.0 | 292.2 | 292.9 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.7 | 8.0 | 0.1 | 303.2 | 311.4 | 80.6 | 0.1 | completed |
| 50 | 1 | 1000 | 998.2 | 39.6 | 0.6 | 416.0 | 476.1 | 80.6 | 0.1 | completed |
| 50 | 1 | 5000 | 4988.4 | 63.3 | 1.0 | 499.1 | 564.8 | 80.6 | 2.3 | completed |
| 50 | 4 | 1000 | 997.3 | 97.0 | 0.8 | 686.8 | 788.7 | 80.6 | 1.3 | completed |
| 50 | 4 | 5000 | 4984.5 | 132.8 | 1.0 | 882.9 | 1023.2 | 80.6 | 13.9 | completed |
| 100 | 4 | 5000 | 4988.5 | 127.6 | 1.1 | 813.3 | 1086.9 | 80.6 | 10.6 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
