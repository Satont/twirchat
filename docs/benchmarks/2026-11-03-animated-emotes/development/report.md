# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: development, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit 82552a53694517829df7500d6c4b96e44f87dd27; dirty tree SHA-256 0c3b9f48fc3da4acc8fa8365d871cef57522e0fda89d0a08edf1f4009abbc43a; runtime inputs SHA-256 14efe81c1e0a2243077f924b54af6487f7b4e2c311b01c1992f76d50f8ae06e4 (356 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.3 | 0.0 | 286.3 | 287.0 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.7 | 67.6 | 0.8 | 499.9 | 588.7 | 80.6 | 2.6 | completed |
| 1 | 1 | 1000 | 996.9 | 99.8 | 0.9 | 571.5 | 732.9 | 80.6 | 8.2 | completed |
| 1 | 1 | 5000 | 4969.8 | 159.1 | 0.9 | 646.5 | 823.7 | 80.6 | 24.3 | completed |
| 10 | 1 | 0 | 0.0 | 1.3 | 0.0 | 282.5 | 282.9 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.8 | 22.8 | 0.4 | 349.4 | 374.4 | 80.6 | 0.7 | completed |
| 10 | 1 | 1000 | 996.6 | 58.5 | 1.1 | 485.3 | 585.1 | 80.6 | 1.6 | completed |
| 10 | 1 | 5000 | 4989.0 | 76.9 | 1.0 | 532.9 | 620.5 | 80.6 | 4.2 | completed |
| 50 | 1 | 0 | 0.0 | 1.3 | 0.0 | 296.3 | 296.6 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.8 | 8.3 | 0.1 | 310.1 | 317.9 | 80.6 | 0.1 | completed |
| 50 | 1 | 1000 | 998.2 | 39.4 | 0.7 | 421.8 | 481.9 | 80.6 | 0.5 | completed |
| 50 | 1 | 5000 | 4992.6 | 67.0 | 1.0 | 481.3 | 569.3 | 80.6 | 2.5 | completed |
| 50 | 4 | 1000 | 997.6 | 91.2 | 0.9 | 683.9 | 828.5 | 80.6 | 0.1 | completed |
| 50 | 4 | 5000 | 4983.3 | 142.4 | 1.1 | 845.4 | 1114.7 | 80.6 | 14.2 | completed |
| 100 | 4 | 5000 | 4988.2 | 137.8 | 1.1 | 823.6 | 969.0 | 80.6 | 11.0 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
