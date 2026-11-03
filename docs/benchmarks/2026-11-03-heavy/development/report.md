# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
React mode: development, verified against the loaded React, JSX runtime and reconciler modules. This runs native application source, not a compiled release binary. Compare algorithm changes only within the same mode.
Source commit e3cff68f098d269bfef9ed76bcdd236f4ea96a47; dirty tree SHA-256 0a49408901fb3a5055d1b8179c4e143662aa701c4a342fb971062af065e7bde7; runtime inputs SHA-256 bc94c7e6d851e928067fcd3965ac037812db04095d612afcee2bb661e662157a (337 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.
User Timing measure entries are counted once after CPU, RSS and GPU measurement ends. This diagnostic does not clear entries or change instrumentation. Counts include warmup and are recorded in JSON/CSV.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.2 | 0.0 | 283.3 | 284.4 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.7 | 56.2 | 1.0 | 495.5 | 595.8 | 80.6 | 1.9 | completed |
| 1 | 1 | 1000 | 997.3 | 87.0 | 1.0 | 601.4 | 762.1 | 80.6 | 4.8 | completed |
| 1 | 1 | 5000 | 4959.0 | 125.4 | 0.9 | 586.6 | 708.3 | 80.6 | 26.6 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 278.7 | 279.2 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 21.6 | 0.4 | 343.6 | 378.8 | 80.6 | 0.6 | completed |
| 10 | 1 | 1000 | 998.2 | 54.6 | 1.1 | 466.4 | 561.2 | 80.6 | 2.1 | completed |
| 10 | 1 | 5000 | 4990.5 | 75.9 | 0.8 | 516.9 | 626.7 | 80.6 | 3.7 | completed |
| 50 | 1 | 0 | 0.0 | 1.3 | 0.0 | 293.1 | 293.5 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.7 | 7.5 | 0.1 | 303.7 | 312.4 | 80.6 | 0.1 | completed |
| 50 | 1 | 1000 | 998.5 | 40.6 | 0.7 | 414.6 | 476.6 | 80.6 | 0.1 | completed |
| 50 | 1 | 5000 | 4991.4 | 60.4 | 0.9 | 487.4 | 557.5 | 80.6 | 2.3 | completed |
| 50 | 4 | 1000 | 997.4 | 90.5 | 0.9 | 679.9 | 771.5 | 80.6 | 0.3 | completed |
| 50 | 4 | 5000 | 4982.5 | 132.2 | 1.0 | 896.8 | 1169.3 | 80.6 | 12.8 | completed |
| 100 | 4 | 5000 | 4981.1 | 130.4 | 1.1 | 885.8 | 988.0 | 80.6 | 11.0 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.
