# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: development, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit dec7ff78f0e2ed8417ae1582847fc2fcafbcdaf7; dirty tree SHA-256 afbf3361f837f79bf52a616595997511f94d7ec5d36aa522b11707008d86f7d4; runtime inputs SHA-256 262a12f340f52ac9a215e65dee4322fbcae560e8f7f95c040bdf25b675803b1e (370 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.2 | 0.0 | 281.1 | 281.8 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.7 | 66.1 | 1.0 | 481.1 | 563.9 | 80.6 | 2.1 | completed |
| 1 | 1 | 1000 | 997.8 | 101.7 | 0.9 | 558.1 | 719.9 | 80.6 | 9.3 | completed |
| 1 | 1 | 5000 | 4918.3 | 141.2 | 0.7 | 645.7 | 757.6 | 80.6 | 27.3 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 280.9 | 281.9 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 22.3 | 0.3 | 341.4 | 370.6 | 80.6 | 0.3 | completed |
| 10 | 1 | 1000 | 998.1 | 63.4 | 0.9 | 485.8 | 582.0 | 80.6 | 2.1 | completed |
| 10 | 1 | 5000 | 4985.9 | 76.3 | 1.0 | 523.3 | 649.5 | 80.6 | 4.5 | completed |
| 50 | 1 | 0 | 0.0 | 1.9 | 0.0 | 291.0 | 291.5 | 80.6 | 0.2 | completed |
| 50 | 1 | 100 | 99.7 | 9.8 | 0.1 | 306.5 | 315.4 | 80.6 | 0.2 | completed |
| 50 | 1 | 1000 | 998.0 | 40.9 | 0.7 | 418.3 | 482.2 | 80.6 | 1.0 | completed |
| 50 | 1 | 5000 | 4984.6 | 95.3 | 0.8 | 494.8 | 575.6 | 80.6 | 4.3 | completed |
| 50 | 4 | 1000 | 997.3 | 108.6 | 0.6 | 706.4 | 799.6 | 80.6 | 5.5 | completed |
| 50 | 4 | 5000 | 4980.2 | 135.4 | 0.6 | 820.6 | 1046.8 | 80.6 | 14.7 | completed |
| 100 | 4 | 5000 | 4970.1 | 135.6 | 0.6 | 789.3 | 956.3 | 80.6 | 17.9 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
