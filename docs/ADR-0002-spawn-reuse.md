# ADR-0002 · Spawn path Ir for bash / grep / find (PRD §12.3)

- Status: Accepted
- Date: 2026-10-31 (Asia/Shanghai)
- Baseline tip: `e610ec8` (v0.3.2)
- Pin: `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` (unchanged)

## Context

User-approved §12.3: lower Valgrind Ir on `bash` / `grep` / `find` via long-lived helper reuse and/or persistent bash session. Gate: `valgrind-ir` + count-ratchet; parity required; no regress on ls/read/edit/write.

### Per-PID Ir (ir-worker, rounds=5, `--trace-children`)

| scenario | parent Node | children | notes |
|---|---:|---|---|
| bash | ~98% of total | `seq` only (~0.56M×N); **no bash PID** | `bash -c` **execs** into the command |
| grep | ~74% | `rg` ~10M×N (~26%) | |
| find | ~80% | `fd` ~7M×N (~20%) | |

## Options tried (evidence)

| choice | result |
|---|---|
| **A. Persistent bash session** (stdin protocol + subshell isolation) | **Reject for Ir** — total Ir **up** (~318M vs ~202M cold, 20×`seq`); subshell forks + readline dominate; `seq` still cold-starts |
| **B. In-process grep/find** (Node walk = “reuse running process as helper”) | **Reject for Ir** — under Valgrind, JS walk+match **costs more** than spawning `rg`/`fd` (grep ~0.69×, find ~0.92× vs official) |
| **C. External multiplex Node helper** | Rejected a priori — extra process Ir under `--trace-children` while still spawning rg/fd per request |
| **D. Parent-side JS on spawn path** | **Accept** — bash `truncateTail` line-scan (no full `string[]` when under byte cap); light grep/find post-process |

## Decision

Ship **D** in `packages/fast-tools` only:

1. **bash:** keep `spawn(bash,['-c',cmd])` (exec into user command is inherent). Optimize `truncateTail` for line-only overflow via `countLinesNoAlloc` + backward newline scan (bench fixture `seq 1 3000`).
2. **grep / find:** keep `rg` / `fd` spawn (native child cheaper than JS under this lab metric). Trim post-process allocs (`truncateLine` skip when short; avoid useless `replace`/`filter`).
3. Document A/B as rejected for **Valgrind Ir** (may revisit for wall-clock UX later).

### Safety

- Parity vs `official-shim` on harness fixtures.
- No cross-call bash state (still one process per call).
- Official pin untouched; powershell untouched.
- Rollback: revert `truncate.mjs` + `tools.mjs` post-process tweaks.

## Deferred (next)

- Native long-lived helper / addon if portfolio wants spawn-amortization that beats `rg`/`fd` under Ir.
- Persistent bash for **wall-clock** agent sessions (not Ir gate).
- gitignore-faithful in-process search (only if metric changes).

## Consequences

§12.3 status → implemented with evidence-backed pivot from “session/helper” to “parent-side spawn-path Ir”; claim only measured README/Page numbers after `/verify` PASS.
