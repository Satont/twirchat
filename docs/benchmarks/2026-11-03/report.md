# TwirChat native chat resource benchmark

CPU: AMD Ryzen 7 9800X3D 8-Core Processor (16 logical CPUs). Linux 7.3.1-1-cachyos; Bun 1.4.4.
Source commit 212ff9255126435a3245400792aaa6dbb90698bf; dirty tree SHA-256 4b4a50c87f670998f94c37fd654fb8d3f8f7266d46c4f9eda7214eea931e0006; runtime inputs SHA-256 dbac8ffd69727fc23642eb836630097621bd4c779fdb4cc3d692082315f15c8b (331 files). Input hashes are verified before and after every case.
GPU clients: amdgpu 0000:03:00.0, amdgpu 0000:47:00.0

Each scenario uses a fresh Bun process, private profile and isolated weston display, 1200×800 window. Channels hold 200 messages before warmup. Total message rate is distributed evenly across channels; only the specified panes are visible. Text-only compact chat; avatars and provider cosmetics disabled. No forced GC.

Warmup 3s; measurement 12s; drain 2s. CPU 100% = one logical core. RAM is process RSS, including native allocations. GPU is per-process DRM graphics-engine time (capacity-normalized), showing the busiest device; its PCI ID is in CSV. GPU is not overall device utilization. n/a means unavailable. DRM VRAM/GTT columns sum resident process allocations across devices; GTT is GPU-mapped system memory and may overlap RSS/shared buffers, so these columns must not be added to RSS as a physical-memory total.

This measures DesktopEvents → real batched stores, similarity path and native ChatView rendering. Process CPU also includes the in-process synthetic message generator and metrics sampler; the isolated display compositor is a separate process. It excludes platform network sockets, protocol parsing, provider enrichment and SQLite chat logging. The host is shared with normal work; clocks and scheduling are not isolated. A generator that falls behind skips excess work instead of accumulating unbounded catch-up; both offered and processed counts are retained in JSON/CSV. React commits are not presented as FPS.

The process RSS safety bound is 2 GiB. A case reaching it stops gracefully and records its actual shorter measurement duration; such rows are marked STOPPED and are not full-duration throughput results.

| Channels | Panes | Target total msg/s | Actual msg/s | CPU % | GPU gfx max-device % | RSS median MiB | RSS peak MiB | VRAM sum MiB | Lag p95 ms | Outcome |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---|
| 1 | 1 | 0 | 0.0 | 1.2 | 0.0 | 283.5 | 284.3 | 80.6 | 0.1 | completed |
| 1 | 1 | 100 | 99.6 | 112.6 | 0.8 | 832.7 | 1147.6 | 80.6 | 18.5 | completed |
| 1 | 1 | 1000 | 998.5 | 136.5 | 0.7 | 827.7 | 1082.0 | 80.6 | 24.9 | completed |
| 1 | 1 | 5000 | 4968.9 | 157.2 | 0.5 | 652.2 | 777.6 | 80.6 | 37.7 | completed |
| 10 | 1 | 0 | 0.0 | 1.2 | 0.0 | 281.0 | 281.8 | 80.6 | 0.1 | completed |
| 10 | 1 | 100 | 99.7 | 46.9 | 0.3 | 559.4 | 694.7 | 80.6 | 1.4 | completed |
| 10 | 1 | 1000 | 996.7 | 108.3 | 0.7 | 842.8 | 1120.3 | 80.6 | 18.6 | completed |
| 10 | 1 | 5000 | 4974.5 | 139.5 | 0.7 | 885.1 | 1266.8 | 80.6 | 23.4 | completed |
| 50 | 1 | 0 | 0.0 | 1.3 | 0.0 | 298.4 | 299.2 | 80.6 | 0.1 | completed |
| 50 | 1 | 100 | 99.8 | 14.9 | 0.1 | 411.0 | 496.3 | 80.6 | 0.4 | completed |
| 50 | 1 | 1000 | 996.5 | 89.4 | 0.6 | 756.1 | 956.7 | 80.6 | 9.3 | completed |
| 50 | 1 | 5000 | 4958.3 | 159.4 | 0.8 | 1043.4 | 1439.8 | 80.6 | 21.1 | completed |
| 50 | 4 | 1000 | 992.2 | 166.4 | 0.4 | 1408.3 | 1922.1 | 80.6 | 61.0 | completed |
| 50 | 4 | 5000 | 2437.7 | 165.7 | 0.3 | 1322.5 | 1750.2 | 80.6 | 80.6 | completed |
| 100 | 4 | 5000 | 2420.2 | 167.3 | 0.3 | 1384.7 | 1751.7 | 80.6 | 81.9 | completed |

Raw per-case JSON, 250ms samples and runtime logs are beside this report. Xvfb runs also include screenshots. Private profile/runtime/framebuffer files are removed after cases; all test processes and displays are closed.

GPU methodology: [Linux DRM usage statistics](https://docs.kernel.org/gpu/drm-usage-stats.html). DRM clients are deduplicated by PCI device/client ID; deprecated memory aliases are not added to resident counters.

Validation: 985 workspace tests passed; 15 PostgreSQL integration tests were skipped. The metrics/parser tests, private native appearance/GPU checks, lint, formatting and typechecks passed. An OAuth test fixture was made independent of previously cached credentials after the measurements; application runtime input hashes remained unchanged. All benchmark processes and private profiles have been removed. The temporary worktree remains at /home/satont/.codex/worktrees/chat-resource-benchmark/chat: Codex archive_worktree refused to remove the task's current primary checkout. Switching the chat back to /home/satont/Documents/Projects/chat is required before archival.

Repeat on the current checkout with `bun run --cwd packages/desktop bench:chat` (Bun 1.4.4, x86-64 Linux).
