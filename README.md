# harness-pi-tools

Accelerate official Pi (`earendil-works/pi`) coding-agent base tools for a portfolio A/B demo.

**Status:** verify PASS · parity PASS · pin `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` · v0.3.0

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
Measured at: `2026-10-30T23:16:45.558Z` (UTC in file; Asia/Taipei = +8)  
Suite Ir sum: official `2095161614` → fast `1989310680` (**1.05×**, fast lower)

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:small | 137656353 | 137813988 | 58 | 49 | 0.046 | 0.044 | 1.00x |
| read:boundary-lines | 248813287 | 249272656 | 453 | 392 | 0.369 | 0.391 | 1.00x |
| bash | 346867643 | 346575914 | 2210 | 2390 | 5.552 | 6.394 | 1.00x |
| edit | 144861753 | 145085770 | 384 | 291 | 0.234 | 0.222 | 1.00x |
| write | 136729135 | 136947212 | 91 | 106 | 0.073 | 0.074 | 1.00x |
| grep | 411525990 | 411165097 | 1714 | 1771 | 6.074 | 6.214 | 1.00x |
| find | 345961586 | 342993299 | 1816 | 1811 | 9.712 | 10.614 | 1.01x |
| ls | 322745867 | 219456744 | 2053 | 183 | 2.581 | 0.148 | 1.47x |

Honest notes: `ls` is the primary Ir/wall win (~1.47× Ir, ~17× wall). Tiny tools are near-parity on Ir (Node startup dominates). Spawn-bound bash/grep/find stay close on Ir.

### Large suite — `results/bench-linux-large.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=11 irRounds=12 paired=in-process+valgrind-ir`  
Measured at: `2026-10-30T23:22:48.652Z` (UTC in file; Asia/Taipei = +8)  
Suite Ir sum: official `4342796776` → fast `4109112307` (**1.06×**)

Generate once: `node fixture/generate-large.mjs` (payloads gitignored).

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:large-2mb | 823042490 | 805982855 | 11141 | 6934 | 11.513 | 8.031 | 1.02x |
| read:near-2000 | 205857037 | 206187578 | 363 | 422 | 0.324 | 0.408 | 1.00x |
| read:near-50kb | 168863864 | 166279906 | 239 | 242 | 0.186 | 0.177 | 1.02x |
| ls:dir-2k | 543386389 | 303264046 | 10161 | 1151 | 15.308 | 1.018 | 1.79x |
| find:dir-2k | 472996205 | 507217072 | 2391 | 5177 | 11.361 | 13.467 | 0.93x |
| grep:large-2mb | 2128650791 | 2120180850 | 16570 | 15765 | 18.882 | 18.69 | 1.00x |

Honest notes: `ls:dir-2k` is the large-suite hero (~1.79× Ir). `find:dir-2k` is slightly worse on Ir on this run (within per-tool ×1.15 ceiling); suite sum still improves.

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
- `PRD.md` — product brief

## Fixture

`fixture/` fixed tree + `fixture/generate-large.mjs` for 2k-dir / ~2.5MB loads.

## Bundled tools

`bin/fd` — sharkdp/fd v10.2.0  
`bin/pe_count` (+ `bin/pe_count.c`) — `perf_event_open` helper for HW/software event probes
