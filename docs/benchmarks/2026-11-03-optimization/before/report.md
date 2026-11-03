# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
Source commit a4e3308cd23b939bbc545d3e0e69419b86d668bb; dirty tree SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; runtime inputs SHA-256 71161764dcbe6cb9f594ba25ff33b6e00178349ea2fd2077d7ed50a8dbec9c02 (336 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.3 | 0.0 | 282.7 | 283.5 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.6 | 114.3 | 0.9 | 862.2 | 1130.0 | 80.6 | 18.7 | completed |
| 1 | 1 | 1000 | 996.8 | 117.9 | 0.9 | 827.2 | 1049.2 | 80.6 | 23.1 | completed |
| 1 | 1 | 5000 | 4949.0 | 157.2 | 0.8 | 682.8 | 824.9 | 80.6 | 32.6 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 280.6 | 281.5 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 44.8 | 0.3 | 533.9 | 666.6 | 80.6 | 2.3 | completed |
| 10 | 1 | 1000 | 997.0 | 107.6 | 0.9 | 891.4 | 1218.8 | 80.6 | 15.3 | completed |
| 10 | 1 | 5000 | 4982.9 | 124.1 | 0.9 | 867.9 | 1209.6 | 80.6 | 20.5 | completed |
| 50 | 1 | 0 | 0.0 | 1.3 | 0.0 | 297.3 | 297.9 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.7 | 14.3 | 0.1 | 406.8 | 487.8 | 80.6 | 0.1 | completed |
| 50 | 1 | 1000 | 996.8 | 83.4 | 0.7 | 745.7 | 1006.0 | 80.6 | 2.5 | completed |
| 50 | 1 | 5000 | 4986.9 | 152.6 | 1.1 | 1065.6 | 1525.8 | 80.6 | 19.0 | completed |
| 50 | 4 | 1000 | 991.8 | 165.2 | 0.5 | 1379.0 | 1865.7 | 80.6 | 63.8 | completed |
| 50 | 4 | 5000 | 2690.5 | 167.2 | 0.5 | 1391.1 | 1891.1 | 80.6 | 52.7 | completed |
| 100 | 4 | 5000 | 2629.8 | 163.2 | 0.5 | 1383.6 | 1795.0 | 80.6 | 57.1 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
