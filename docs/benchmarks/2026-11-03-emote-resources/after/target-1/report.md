# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: production, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit 5c4f706ba2fe21bdad9bc065bf690ba3e2389c74; dirty tree SHA-256 5e4f2448b1ca8810a42a91b5e68c5eaa66364788342fee9844073c554cd1a0ca; runtime inputs SHA-256 3a70a065cd949a806304a6b536803336309ef2ffd8121b5bec649b929ef93738 (370 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 30s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 50 | 4 | 5000 | 4996.5 | 114.5 | 1.2 | 511.2 | 633.1 | 80.6 | 2.6 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
