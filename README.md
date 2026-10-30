# harness-pi-tools

Accelerate official Pi (`earendil-works/pi`) coding-agent base tools for a portfolio A/B demo.

**Status:** verify PASS · parity PASS · pin `86dc686cf2fd795b2b24af3d614bb0e1307bcd76`

License: MIT

## What this is

- **Pin:** `/workspace/earendil-pi` @ `86dc686`
- **Official shim:** `packages/official-shim` — faithful TS port for harness runners
- **Fast path:** `packages/fast-tools` — `ts-optimize` (see `docs/ADR-0001-tech-choice.md`)
- **Switch:** `HARNESS_TOOLS=official|fast` / `node harness/measure.mjs official|fast`

## Measured A/B (linux only)

Source: `results/bench-linux.json`  
Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=5`  
Measured at: `2026-10-30T21:06:46.009Z` (UTC in file; Asia/Taipei = +8)

**Primary metric CPU events:** unavailable on this box (`-1`). Secondary: `softCpuUs` = `process.cpuUsage` user+system µs (avg over rounds), `wallMs` = median of 5 rounds after 1 warmup, `peakRssKb` from `/proc/self/status` VmHWM.

| tool | officialCpu | fastCpu | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | officialRssKb | fastRssKb | wall ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| read | -1 | -1 | 1199 | 5346 | 1.064 | 1.999 | 56640 | 62468 | 0.53x |
| bash | -1 | -1 | 3040 | 2889 | 2.947 | 2.889 | 61280 | 64880 | 1.02x |
| edit | -1 | -1 | 374 | 474 | 0.516 | 0.404 | 61020 | 65064 | 1.28x |
| write | -1 | -1 | 134 | 142 | 0.237 | 0.119 | 61036 | 65076 | 1.99x |
| grep | -1 | -1 | 1158 | 3263 | 3.554 | 3.565 | 61092 | 64936 | 1.00x |
| find | -1 | -1 | 1070 | 864 | 5.47 | 4.927 | 61196 | 65000 | 1.11x |
| ls | -1 | -1 | 3221 | 299 | 2.304 | 0.214 | 65060 | 68040 | 10.77x |

### macos

**SKIP** — no macOS host available this run. See `results/bench-macos.json`.

## Parity

```bash
node harness/parity.mjs
```

Result: `results/parity.json` → passed=true.

Note: harness `grep` uses `rg --sort path` so A/B order is stable (upstream JSON stream order is not).

## Verify

```bash
node harness/verify.mjs
```

## Docs

- `docs/ADR-0001-tech-choice.md` — ts-optimize
- `docs/ADAPTER.md` — embed + standalone
- `docs/AUDIT-truncation.md` — 2000/50KB rationale; recommended `env-config`
- `workflows/harness-full.js` — FULL 12-phase workflow
- `PRD.md` — product brief

## Fixture

`fixture/` — fixed tree (js/ts/go, deep dirs, boundary files). Do not swap when comparing numbers.

## Bundled tools

`bin/fd` — sharkdp/fd v10.2.0 (used when system `fd` missing).
