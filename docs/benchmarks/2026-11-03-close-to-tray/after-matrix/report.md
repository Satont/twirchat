# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: development, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit 82552a53694517829df7500d6c4b96e44f87dd27; dirty tree SHA-256 45f25cfd21cc817bf3fe46b8e9d28825b817b439bbf4d8269352ab641c62f9c2; runtime inputs SHA-256 e87f2c0e344dccb2339c0c1ac09fbfc7ff327a71c1dab071dd946adb5869bd33 (354 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.2 | 0.0 | 277.2 | 278.0 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.7 | 71.2 | 0.9 | 492.4 | 600.8 | 80.6 | 2.9 | completed |
| 1 | 1 | 1000 | 997.8 | 101.5 | 0.9 | 575.6 | 730.6 | 80.6 | 7.7 | completed |
| 1 | 1 | 5000 | 4960.1 | 169.6 | 0.7 | 699.8 | 827.4 | 80.6 | 30.1 | completed |
| 10 | 1 | 0 | 0.0 | 1.3 | 0.0 | 274.5 | 275.8 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 22.6 | 0.3 | 338.6 | 365.3 | 80.6 | 0.1 | completed |
| 10 | 1 | 1000 | 997.9 | 64.1 | 1.0 | 472.0 | 582.7 | 80.6 | 2.5 | completed |
| 10 | 1 | 5000 | 4987.2 | 81.0 | 1.0 | 517.1 | 708.4 | 80.6 | 4.0 | completed |
| 50 | 1 | 0 | 0.0 | 1.2 | 0.0 | 288.6 | 289.5 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.7 | 7.8 | 0.1 | 303.0 | 311.1 | 80.6 | 0.1 | completed |
| 50 | 1 | 1000 | 997.1 | 40.6 | 0.7 | 409.4 | 468.2 | 80.6 | 0.1 | completed |
| 50 | 1 | 5000 | 4984.3 | 66.1 | 1.0 | 485.1 | 531.0 | 80.6 | 2.0 | completed |
| 50 | 4 | 1000 | 997.4 | 99.4 | 0.9 | 679.2 | 786.1 | 80.6 | 4.9 | completed |
| 50 | 4 | 5000 | 4986.0 | 140.8 | 1.0 | 851.0 | 1057.7 | 80.6 | 14.0 | completed |
| 100 | 4 | 5000 | 4981.4 | 134.6 | 1.2 | 827.6 | 1041.0 | 80.6 | 10.2 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
