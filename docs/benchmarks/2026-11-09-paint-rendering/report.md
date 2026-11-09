# 7TV paint rasterization

Cold rasterization was measured on a Ryzen 7 9800X3D with Bun 1.4.4, libvips
8.18.7 and librsvg 2.63.2. Each run rendered 300 unique names (from
`LongViewer0010` through `LongViewer0309`) in Inter 18 with an empty temporary
cache and ten untimed warmup renders. Two renders ran concurrently. Each
repetition used a fresh process and profile. Run order was before, after,
after, before, before, after for each fixture. Builds and tests ran separately.

Both fixtures used a 35° linear gradient with stops at 0, 0.42 and 1. The
opaque stops were `#ff0000`, `#0025ff` and `#23aa9b`. The translucent fixture
used `#ff000040` for the first stop and added two shadows. The first shadow
used `#2277ffa0`, offset (1, 2) and blur 3. The second used `#000000b0`, offset
(-2, 0) and blur 4.

Values are medians (min–max). CPU time includes libvips worker threads.

| Fixture | Version | Wall ms | CPU ms | RSS median MiB | RSS peak MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| Opaque | Before | 520 (508–540) | 960 (945–978) | 98.81 (98.63–99.24) | 104.79 (103.93–105.15) |
| Opaque | After | 511 (498–515) | 948 (929–952) | 100.27 (100.16–101.09) | 105.17 (104.60–105.96) |
| Translucent with shadows | Before | 715 (702–729) | 1901 (1898–1926) | 97.91 (97.53–100.18) | 102.21 (101.49–103.44) |
| Translucent with shadows | After | 725 (722–770) | 1937 (1928–1961) | 99.82 (97.92–100.67) | 104.68 (102.77–106.74) |

The translucent fixture took 1.9% more CPU time and 1.9% more median RSS while
rendering premultiplied gradients and independent shadows. These measurements
cover generation of cached WebP files.

## Provenance and native QA

- Baseline source was `62ab7e337657864f2b0fc0b2e64e7c8d2be7ecd1`. The baseline
  probe copied the two renderer files and redirected their imports to the same
  workspace. Candidate SHA-256 values were
  `876c0f3a37c490081c7ffa09bc627a16a68dbabf1fd0f623a90fabaad2d261d1` for
  `cosmetics.ts` and `91076288c37e658d54a0d8bdd164260c97cff6d86d7afb5a229fb7ffdf5632b2`
  for `paint-renderer.ts`. Raw samples and the local probe are in
  `/tmp/twirchat-paint-perf.yzdeNg`.
- Isolated Xvfb production QA checked painted mentions in both chat layouts
  at 420×300 and 900×600 with live incoming messages. Native GPUIX
  `0.11.0-twirchat.24` had SHA-256
  `71327b75a3411066aae09f0cdaa1849b1f80df283910a68cc81e1623ddad0afc`.
- The default text matrix disables provider paints. Its previous measurements
  with these native bytes are in the [shared image resource report](../2026-11-09-process-image-cache/report.md).

```sh
bun run --cwd packages/desktop qa:gui --dbus --display-width 1200 --display-height 800 --node-env production --keep --timeout 60 -- bun scripts/qa-mention-user-card.tsx
```
