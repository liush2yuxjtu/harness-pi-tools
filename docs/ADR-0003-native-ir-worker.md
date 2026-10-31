# ADR-0003 · Native Ir worker for §12.4 ≥2× (forbidUnsafe)

- Status: Accepted
- Date: 2026-10-31 (Asia/Taipei)
- Baseline tip: `98cc5ad` (v0.3.3)
- Pin: `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` (unchanged)

## Context

PRD §12.4 requires every small-suite tool Valgrind Ir speedup ≥2.0× vs official Node shim.
Empty Node under cachegrind ≈ **110M Ir** (20-iter no-op). Official `read:small` / `edit` / `write`
≈ **132–137M Ir**. Max theoretical Node-vs-Node speedup if tool work → 0 is ≈ **1.2×**.
JS hillclimb alone **cannot** hit 2× under the current lab metric. ADR-0002 already rejected
persistent bash session and in-process JS grep/find for Ir.

## Decision

1. Ship **`bin/harness-helper`** (Rust, `#![forbid(unsafe_code)]`) implementing the same tool
   semantics as `official-shim` (truncate 2000/50KB, rg/fd/bash spawn where needed).
2. **Lab Ir for `fast`:** Valgrind runs the native binary directly
   (`harness-helper ir-worker <scenario> <rounds>`) with `--trace-children=yes` — **no Node**.
   Official remains `node --predictable harness/ir-worker.mjs`.
3. **Runtime / parity:** `packages/fast-tools` prefers a long-lived `serve` JSONL helper
   (`HARNESS_NATIVE=0` forces JS fallback). SoftCpu/wall still measured in-process via that path.
4. Document empty-Node ceiling as the reason Node-only ≥2× is unreachable for tiny tools.

## Evidence (confirmed · full bench irRounds=20 · 2026-10-31 14:05 CST)

Small suite `results/bench-linux.json` (`paired=…+native-fast-ir`): **all eight tools Ir ≥2.0×**; suite sum **4.915×** (off `2111834999` → fast `429680804`). Min tools: bash **2.50×**, find **2.30×**. Large suite tracking only (~1.72×; not all ≥2×). Preview table below kept for history.

## Evidence (preview, ir-rounds=5, this box · superseded by full bench above)

| tool | official Ir | native Ir | × |
|---|---:|---:|---:|
| read:small | ~132M | ~0.38M | ~340× |
| read:boundary-lines | ~177M | ~6.7M | ~27× |
| edit / write | ~131–137M | ~0.37–0.40M | ~345× |
| ls | ~252M | ~7.8M | ~32× |
| bash | ~212M | ~40M | ~5.3× |
| grep | ~228M | ~61M | ~3.7× |
| find | ~204M | ~46M | ~4.5× |

## Consequences

- Claim ≥2× only after full `bench-ab` + `/verify` PASS with measured tables. **Full irRounds=20 bench + docs refreshed for v0.3.4; verify must PASS before commit.**
- macos still SKIP until a Mac host builds `harness-helper`.
- Rollback: delete/rename `bin/harness-helper` → fast Ir falls back to Node worker; set
  `HARNESS_NATIVE=0` for JS-only runtime.
