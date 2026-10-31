# harness-pi-tools

Accelerate official Pi (`earendil-works/pi`) coding-agent base tools for a portfolio A/B demo.

**Status:** verify PASS · parity PASS · pin `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` · v0.3.3 (§12.3 spawn-path Ir)

License: MIT

## What this is

- **Pin:** `/workspace/earendil-pi` @ `86dc686`
- **Official shim:** `packages/official-shim` — faithful TS port for harness runners
- **Fast path:** `packages/fast-tools` — `ts-optimize` (see `docs/ADR-0001-tech-choice.md`, `docs/ADR-0002-spawn-reuse.md`)
- **Switch:** `HARNESS_TOOLS=official|fast` via `packages/switch-surface.mjs` / `scripts/ab-demo.mjs`

## Measured A/B (linux)

Fair A/B: `node harness/bench-ab.mjs` (in-process wall/soft + out-of-process Valgrind Ir).

**Lab primary:** `metric=valgrind-ir` (cachegrind `Ir`, `--trace-children=yes`, sum of parent+child summaries; `node --predictable`).  
Probe order: perf HW instructions → Valgrind Ir → other events → soft-cpu-proxy (see `docs/METRICS.md`).  
This box: no `cpu` PMU → HW instructions SKIP; **Valgrind Ir wins**.  
**`wallMs` is display-only** — verify ratchets counts (suite sum ×1.05 + per-tool ×1.15), not wall.

### Small suite — `results/bench-linux.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=21 irRounds=20 paired=in-process+valgrind-ir`  
Measured at: 2026-10-31 13:11 CST (file UTC 2026-10-31T05:11:22.668Z)  
Suite Ir sum: official `2103797663` → fast `1844060000` (**1.14×**, fast lower)

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:small | 137675208 | 137641718 | 183 | 46 | 0.042 | 0.033 | 1.00x |
| read:boundary-lines | 248847003 | 173886417 | 494 | 199 | 0.34 | 0.174 | 1.43x |
| bash | 346385066 | 265168320 | 2194 | 2083 | 4.645 | 4.443 | 1.31x |
| edit | 144849457 | 145189627 | 369 | 193 | 0.219 | 0.245 | 1.00x |
| write | 136730272 | 136882223 | 113 | 102 | 0.096 | 0.077 | 1.00x |
| grep | 418186971 | 418301057 | 1670 | 1738 | 5.866 | 5.886 | 1.00x |
| find | 347719554 | 346629600 | 1758 | 1799 | 7.094 | 7.077 | 1.00x |
| ls | 323404132 | 220361038 | 1796 | 106 | 1.712 | 0.097 | 1.47x |

Honest notes: **bash ~1.31×** via optimized `truncateTail` (ADR-0002). `read:boundary-lines` ~1.43× and `ls` ~1.47× kept. grep/find stay near parity (native `rg`/`fd` cheaper than in-process under Valgrind Ir). Persistent bash session and in-process grep/find were measured and **rejected** for this lab metric.

### Large suite — `results/bench-linux-large.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=11 irRounds=12 paired=in-process+valgrind-ir`  
Measured at: 2026-10-31 13:14 CST (file UTC 2026-10-31T05:14:16.546Z)  
Suite Ir sum: official `4304387977` → fast `3424533676` (**1.26×**)

Generate once: `node fixture/generate-large.mjs` (payloads gitignored).

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:large-2mb | 784032193 | 428819786 | 8453 | 4363 | 7.478 | 2.73 | 1.83x |
| read:near-2000 | 205842784 | 159579149 | 316 | 182 | 0.313 | 0.166 | 1.29x |
| read:near-50kb | 168893687 | 160863796 | 317 | 160 | 0.219 | 0.14 | 1.05x |
| ls:dir-2k | 543450122 | 303680440 | 10985 | 1286 | 31.924 | 1.233 | 1.79x |
| find:dir-2k | 471041755 | 514987406 | 2296 | 2561 | 20.079 | 22.316 | 0.91x |
| grep:large-2mb | 2131127436 | 1856603099 | 17866 | 12845 | 22.081 | 18.464 | 1.15x |

Honest notes: `grep:large-2mb` ~1.15× (post-process). `find:dir-2k` still slightly worse on Ir (within per-tool ×1.15). `read:large-2mb` / `ls:dir-2k` remain large wins.

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
