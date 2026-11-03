# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
Source commit a4e3308cd23b939bbc545d3e0e69419b86d668bb; dirty tree SHA-256 39635da42cc0d4405158ebe365699e969286d31fa1e39aabaeb46fd002f1b6a6; runtime inputs SHA-256 13ea0b458aadd37df2fb3960ce80a032549058c6c36b2eaead39431dcef69e52 (337 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.3 | 0.0 | 282.1 | 283.1 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.7 | 73.6 | 0.8 | 476.5 | 560.4 | 80.6 | 2.4 | completed |
| 1 | 1 | 1000 | 997.8 | 103.5 | 0.9 | 577.7 | 755.0 | 80.6 | 10.1 | completed |
| 1 | 1 | 5000 | 4972.2 | 161.9 | 0.8 | 689.2 | 836.8 | 80.6 | 27.6 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 281.7 | 282.8 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 24.3 | 0.3 | 349.2 | 379.4 | 80.6 | 1.0 | completed |
| 10 | 1 | 1000 | 997.2 | 67.3 | 0.9 | 490.6 | 577.3 | 80.6 | 2.5 | completed |
| 10 | 1 | 5000 | 4988.9 | 90.0 | 0.9 | 529.9 | 633.2 | 80.6 | 4.5 | completed |
| 50 | 1 | 0 | 0.0 | 1.3 | 0.0 | 295.1 | 295.9 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.7 | 8.3 | 0.1 | 312.1 | 321.1 | 80.6 | 0.1 | completed |
| 50 | 1 | 1000 | 997.4 | 47.0 | 0.6 | 448.4 | 512.9 | 80.6 | 0.6 | completed |
| 50 | 1 | 5000 | 4990.5 | 87.9 | 0.8 | 527.6 | 616.7 | 80.6 | 3.7 | completed |
| 50 | 4 | 1000 | 996.9 | 110.9 | 0.8 | 720.0 | 825.6 | 80.6 | 4.7 | completed |
| 50 | 4 | 5000 | 4992.1 | 149.1 | 0.7 | 913.9 | 1134.4 | 80.6 | 15.8 | completed |
| 100 | 4 | 5000 | 4985.6 | 160.2 | 0.8 | 945.8 | 1136.4 | 80.6 | 13.5 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
