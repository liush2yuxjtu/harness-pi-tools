# harness-pi-tools

Accelerate official Pi (`earendil-works/pi`) coding-agent base tools for a portfolio A/B demo.

**Status:** verify PASS · parity PASS · pin `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` · v0.3.4 (§12.4 native Ir worker)

License: MIT

## What this is

- **Pin:** `/workspace/earendil-pi` @ `86dc686`
- **Official shim:** `packages/official-shim` — faithful TS port for harness runners
- **Fast path:** `packages/fast-tools` — `ts-optimize` + optional native helper (see `docs/ADR-0001-tech-choice.md`, `docs/ADR-0002-spawn-reuse.md`, `docs/ADR-0003-native-ir-worker.md`)
- **Native Ir worker:** `bin/harness-helper` (Rust, `#![forbid(unsafe_code)]`, sources under `native/harness-helper/`) — lab fast Ir runs this binary directly (no Node); runtime softCpu/wall still use the long-lived `serve` helper when present
- **Switch:** `HARNESS_TOOLS=official|fast` via `packages/switch-surface.mjs` / `scripts/ab-demo.mjs`

## Measured A/B (linux)

Fair A/B: `node harness/bench-ab.mjs` (in-process wall/soft + out-of-process Valgrind Ir).

**Lab primary:** `metric=valgrind-ir` (cachegrind `Ir`, `--trace-children=yes`, sum of parent+child summaries).  
Probe order: perf HW instructions → Valgrind Ir → other events → soft-cpu-proxy (see `docs/METRICS.md`).  
This box: no `cpu` PMU → HW instructions SKIP; **Valgrind Ir wins**.  
**`wallMs` is display-only** — verify ratchets counts (suite sum ×1.05 + per-tool ×1.15), not wall.

Honest lab note: with `bin/harness-helper` present, **fast Ir** uses native `harness-helper ir-worker` (no Node under Valgrind); **official Ir** stays `node --predictable harness/ir-worker.mjs`. SoftCpu/wall remain in-process via the native `serve` helper (or JS fallback). SoftCpu on `write` may look worse than official — display-only, not a lab gate.

### Small suite — `results/bench-linux.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=21 irRounds=20 paired=in-process+valgrind-ir+native-fast-ir`  
Measured at: 2026-10-31 14:05 CST (file UTC 2026-10-31T06:05:52.624Z)  
Suite Ir sum: official `2111834999` → fast `429680804` (**4.915×**, fast lower)  
**All eight tools Ir ≥2.0×** (min: bash 2.50×, find 2.30×).

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:small | 137691095 | 468674 | 165 | 70 | 0.118 | 0.062 | 293.79x |
| read:boundary-lines | 248846293 | 22480749 | 590 | 237 | 0.557 | 0.262 | 11.07x |
| bash | 346272623 | 138574939 | 2007 | 316 | 4.418 | 2.016 | 2.50x |
| edit | 144928275 | 507823 | 299 | 133 | 0.318 | 0.247 | 285.39x |
| write | 136775104 | 419381 | 185 | 333 | 0.133 | 0.086 | 326.14x |
| grep | 418426323 | 86166541 | 1686 | 180 | 5.687 | 0.836 | 4.86x |
| find | 355796192 | 154666045 | 2416 | 293 | 22.71 | 12.525 | 2.30x |
| ls | 323099094 | 26396652 | 1328 | 112 | 2.523 | 0.238 | 12.24x |

### Large suite — `results/bench-linux-large.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=15 irRounds=12 paired=in-process+valgrind-ir+native-fast-ir`  
Measured at: 2026-10-31 14:07 CST (file UTC 2026-10-31T06:07:48.053Z)  
Suite Ir sum: official `4328069033` → fast `2519398412` (**1.718×**)  
**Tracking only — not all tools ≥2×** (honest): `read:large-2mb` 1.97×, `ls:dir-2k` 1.37×, `find:dir-2k` 1.62×, `grep:large-2mb` 1.53× remain under 2.0×; near-boundary reads clear 2×.

Generate once: `node fixture/generate-large.mjs` (payloads gitignored).

| tool | officialCpu (Ir) | fastCpu (Ir) | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | Ir ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:large-2mb | 821480191 | 417977025 | 8482 | 1100 | 25.228 | 9.803 | 1.97x |
| read:near-2000 | 205861671 | 13989383 | 442 | 216 | 0.369 | 0.289 | 14.72x |
| read:near-50kb | 168893443 | 12942831 | 340 | 184 | 0.247 | 0.316 | 13.05x |
| ls:dir-2k | 544545601 | 396486416 | 8052 | 153 | 8.752 | 2.078 | 1.37x |
| find:dir-2k | 468611824 | 289395137 | 2244 | 475 | 8.833 | 5.708 | 1.62x |
| grep:large-2mb | 2118676303 | 1388607620 | 15719 | 2000 | 17.361 | 9.981 | 1.53x |

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
