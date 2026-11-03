# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: development, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit 5c4f706ba2fe21bdad9bc065bf690ba3e2389c74; dirty tree SHA-256 5e4f2448b1ca8810a42a91b5e68c5eaa66364788342fee9844073c554cd1a0ca; runtime inputs SHA-256 3a70a065cd949a806304a6b536803336309ef2ffd8121b5bec649b929ef93738 (370 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.2 | 0.0 | 284.5 | 285.5 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.7 | 65.9 | 0.9 | 478.3 | 567.9 | 80.6 | 2.9 | completed |
| 1 | 1 | 1000 | 997.2 | 99.9 | 0.9 | 568.4 | 704.1 | 80.6 | 7.4 | completed |
| 1 | 1 | 5000 | 4990.2 | 169.8 | 0.9 | 693.2 | 844.4 | 80.6 | 20.9 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 282.4 | 282.8 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 21.5 | 0.3 | 346.3 | 378.1 | 80.6 | 0.9 | completed |
| 10 | 1 | 1000 | 997.5 | 59.1 | 1.0 | 486.5 | 588.6 | 80.6 | 2.0 | completed |
| 10 | 1 | 5000 | 4985.4 | 77.0 | 0.9 | 523.4 | 629.6 | 80.6 | 3.9 | completed |
| 50 | 1 | 0 | 0.0 | 1.3 | 0.0 | 297.7 | 298.3 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.7 | 8.1 | 0.1 | 311.7 | 320.8 | 80.6 | 0.1 | completed |
| 50 | 1 | 1000 | 998.2 | 37.6 | 0.6 | 419.3 | 473.8 | 80.6 | 0.1 | completed |
| 50 | 1 | 5000 | 4991.2 | 62.3 | 1.0 | 484.3 | 530.0 | 80.6 | 2.2 | completed |
| 50 | 4 | 1000 | 997.3 | 95.2 | 0.8 | 677.2 | 815.7 | 80.6 | 0.1 | completed |
| 50 | 4 | 5000 | 4983.7 | 142.8 | 1.1 | 851.5 | 1012.1 | 80.6 | 13.7 | completed |
| 100 | 4 | 5000 | 4988.1 | 137.1 | 1.2 | 899.4 | 1037.1 | 80.6 | 10.3 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
