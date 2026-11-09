# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: development, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit bdb8e7d31897dac8444765a9184f4f305f1cb41c; dirty tree SHA-256 842a890bdd2233ca46052e98cf36a8c8b197bd7085788e7da98c0e872c1985a5; runtime inputs SHA-256 5f11de0df736e86071ae97bcb126b406f4ea7b0a1a065416e7fbb3813962aee4 (455 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.1 | 0.0 | 244.8 | 245.8 | 80.6 | 0.0 | completed |
| 1 | 1 | 100 | 99.7 | 24.6 | 0.6 | 376.1 | 428.7 | 80.6 | 0.6 | completed |
| 1 | 1 | 1000 | 994.1 | 32.8 | 0.6 | 420.4 | 528.3 | 80.6 | 3.5 | completed |
| 1 | 1 | 5000 | 4971.0 | 35.5 | 0.6 | 403.5 | 514.5 | 80.6 | 2.9 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 250.9 | 251.8 | 80.6 | 0.0 | completed |
| 10 | 1 | 100 | 99.7 | 14.6 | 0.4 | 305.7 | 330.5 | 80.6 | 0.0 | completed |
| 10 | 1 | 1000 | 997.8 | 24.7 | 0.6 | 373.6 | 437.1 | 80.6 | 1.9 | completed |
| 10 | 1 | 5000 | 4991.0 | 32.2 | 0.5 | 390.2 | 508.6 | 80.6 | 3.0 | completed |
| 50 | 1 | 0 | 0.0 | 1.2 | 0.0 | 263.9 | 264.6 | 80.6 | 0.0 | completed |
| 50 | 1 | 100 | 99.5 | 5.8 | 0.1 | 275.5 | 281.9 | 80.6 | 0.0 | completed |
| 50 | 1 | 1000 | 997.0 | 21.5 | 0.6 | 356.6 | 400.2 | 80.6 | 0.2 | completed |
| 50 | 1 | 5000 | 4986.0 | 25.7 | 0.6 | 391.3 | 480.9 | 80.6 | 1.3 | completed |
| 50 | 4 | 1000 | 995.9 | 45.3 | 0.7 | 551.8 | 663.1 | 80.6 | 6.6 | completed |
| 50 | 4 | 5000 | 4977.5 | 58.1 | 0.7 | 555.9 | 685.8 | 80.6 | 12.0 | completed |
| 100 | 4 | 5000 | 4981.6 | 52.7 | 0.7 | 505.0 | 624.5 | 80.6 | 9.9 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
