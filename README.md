# harness-pi-tools

Accelerate official Pi (`earendil-works/pi`) coding-agent base tools for a portfolio A/B demo.

**Status:** verify PASS · parity PASS · pin `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` · v0.3.1 (Ir hillclimb)

License: MIT

## What this is

- **Pin:** `/workspace/earendil-pi` @ `86dc686`
- **Official shim:** `packages/official-shim` — faithful TS port for harness runners
- **Fast path:** `packages/fast-tools` — `ts-optimize` (see `docs/ADR-0001-tech-choice.md`)
- **Switch:** `HARNESS_TOOLS=official|fast` via `packages/switch-surface.mjs` / `scripts/ab-demo.mjs`

## Measured A/B (linux)

Fair A/B: `node harness/bench-ab.mjs` (in-process wall/soft + out-of-process Valgrind Ir).

**Lab primary:** `metric=valgrind-ir` (cachegrind `Ir`, `--trace-children=yes`, sum of parent+child summaries; `node --predictable`).  
Probe order: perf HW instructions → Valgrind Ir → other events → soft-cpu-proxy (see `docs/METRICS.md`).  
This box: no `cpu` PMU → HW instructions SKIP; **Valgrind Ir wins**.  
**`wallMs` is display-only** — verify ratchets counts (suite sum ×1.05 + per-tool ×1.15), not wall.

### Small suite — `results/bench-linux.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=21 irRounds=20 paired=in-process+valgrind-ir`  
Measured at: `2026-10-31T04:04:39.721Z` (UTC in file; Asia/Taipei = +8)  
Suite Ir sum: official `2104046153` → fast `1985855823` (**1.06×**, fast lower)

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:small | 137674907 | 136636850 | 110 | 89 | 0.075 | 0.062 | 1.01x |
| read:boundary-lines | 248848007 | 233314714 | 365 | 302 | 0.360 | 0.280 | 1.07x |
| bash | 346495005 | 345795212 | 2085 | 2344 | 4.515 | 4.221 | 1.00x |
| edit | 144930984 | 144818863 | 240 | 340 | 0.203 | 0.195 | 1.00x |
| write | 136770752 | 136438154 | 144 | 114 | 0.106 | 0.077 | 1.00x |
| grep | 414391247 | 414592275 | 1765 | 1689 | 5.586 | 5.655 | 1.00x |
| find | 352211654 | 354538400 | 2922 | 2973 | 33.028 | 35.408 | 0.99x |
| ls | 322723597 | 219721355 | 1348 | 158 | 1.326 | 0.136 | 1.47x |

Honest notes: `ls` remains the primary small-suite Ir/wall win (~1.47× Ir). v0.3.1 hillclimb flips `read:small` / `read:boundary-lines` / `edit` / `write` to `fastCpu < officialCpu` (boundary ~1.07×). Spawn-bound bash/grep/find stay near parity (not this round’s hard target).

### Large suite — `results/bench-linux-large.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=11 irRounds=12 paired=in-process+valgrind-ir`  
Measured at: `2026-10-31T04:07:47.703Z` (UTC in file; Asia/Taipei = +8)  
Suite Ir sum: official `4311167430` → fast `3650440477` (**1.18×**)

Generate once: `node fixture/generate-large.mjs` (payloads gitignored).

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:large-2mb | 794095075 | 369493161 | 9760 | 4539 | 17.870 | 9.676 | 2.15x |
| read:near-2000 | 205870671 | 196205522 | 377 | 332 | 0.316 | 0.241 | 1.05x |
| read:near-50kb | 168892351 | 160155664 | 424 | 154 | 0.202 | 0.139 | 1.05x |
| ls:dir-2k | 544637418 | 303353928 | 8026 | 1299 | 8.088 | 0.994 | 1.80x |
| find:dir-2k | 473426124 | 514464634 | 2827 | 3200 | 9.979 | 11.903 | 0.92x |
| grep:large-2mb | 2124245791 | 2106767568 | 17489 | 16782 | 41.848 | 32.155 | 1.01x |

Honest notes: **`read:large-2mb` is the v0.3.1 hero (~2.15× Ir)** via no join→re-split truncate. `ls:dir-2k` still ~1.80×. `find:dir-2k` slightly worse on Ir (within per-tool ×1.15); suite sum still improves a lot.

### macos

**SKIP** — no macOS host. See `results/bench-macos.json`.

## Parity

```bash
node harness/parity.mjs
```

## Verify

```bash
node harness/verify.mjs
```

Lab gate includes deterministic `metric` + count ratchet (not wallMs).

## Embed A/B (5 steps)

```bash
cd /workspace/harness-pi-tools
export HARNESS_TOOLS=official
node scripts/ab-demo.mjs ls --path src/js
HARNESS_TOOLS=fast node scripts/ab-demo.mjs ls --path src/js
HARNESS_TOOLS=official node scripts/ab-demo.mjs --bench ls --path src/js
HARNESS_TOOLS=fast     node scripts/ab-demo.mjs --bench ls --path src/js
node scripts/ab-demo.mjs read --path boundary/lines_2500.txt
```

Details: `docs/ADAPTER.md`.

## Docs

- `docs/ADR-0001-tech-choice.md` — ts-optimize
- `docs/ADAPTER.md` — embed + standalone
- `docs/AUDIT-truncation.md` — 2000/50KB
- `docs/METRICS.md` — probe chain, Ir, ceilings, wallMs role
- `PRD.md` — product brief (+ §12 Ir hillclimb goal)

## Fixture

`fixture/` fixed tree + `fixture/generate-large.mjs` for 2k-dir / ~2.5MB loads.

## Bundled tools

`bin/fd` — sharkdp/fd v10.2.0  
`bin/pe_count` (+ `bin/pe_count.c`) — `perf_event_open` helper for HW/software event probes
