# Changelog

## 0.3.3 — 2026-10-31 (Asia/Shanghai)

- **/goal §12.3 spawn-path Ir:** evidence in `docs/ADR-0002-spawn-reuse.md` — persistent bash session and in-process grep/find **rejected** under Valgrind Ir; ship parent-side wins instead.
- Fast `truncateTail`: under byte cap use `countLinesNoAlloc` + backward newline scan for line-only overflow (bash `seq 1 3000` path) — small-suite **bash ~1.31×**.
- Fast grep/find: keep `rg`/`fd` spawn; skip `truncateLine` when short; trim trailing-newline handling.
- Measured small suite sum **~1.14×**; large suite sum **~1.26×** (`grep:large-2mb` ~1.15×). `ls` / `read:boundary-lines` kept.


## 0.3.2 — 2026-10-31 (Asia/Shanghai)

- Ir hillclimb deepen: `truncateFromCountingLines` line-only path (under byte cap) skips per-line `Buffer.byteLength` — `read:boundary-lines` **1.43×**.
- Fast `toolEdit`: `Buffer→toString` (not `readFile` utf-8 option) + `lastIndexOf` uniqueness check (lower Valgrind Ir).
- Measured small suite sum **1.10×** (official `2111772714` → fast `1926290642`); all four targets `read:small` / `read:boundary-lines` / `edit` / `write` have `fastCpu < officialCpu`. `ls` ~1.47× kept.

## 0.3.1 — 2026-10-31 (Asia/Taipei)

- **/goal Ir hillclimb:** press Valgrind Ir on JS hot paths (`read` / `edit` / `write` / `truncate`); spawn tools (bash/grep/find) not hard targets this round.
- Fast `toolRead`: skip `access`; whole-file under byte cap uses one split + `underLimitTruncation` (no `truncateHead` re-split); over-limit uses `truncateHeadFromSplit` with known `totalBytes` / `underLimitContent` (no full join→re-split).
- Fast `toolWrite`: try `writeFile` first, `mkdir` only on `ENOENT`.
- Fast `toolEdit`: skip `access(R_OK|W_OK)`.
- Measured (lab `valgrind-ir`): small suite sum **1.06×** (was 1.05×); `read:boundary-lines` **1.07×**; `read:large-2mb` **2.15×**; large suite sum **1.18×**. `wallMs` display-only; verify count-ratchet unchanged.
- PRD §12 documents the hillclimb goal.

## 0.3.0 — 2026-10-31 (Asia/Taipei)

- **Deterministic lab metric:** probe chain perf-instructions → Valgrind cachegrind `Ir` (`--trace-children`, sum summaries, `node --predictable`) → page-faults → soft-cpu-proxy.
- This box selects **`valgrind-ir`** (no cpu PMU; distro `perf` may be broken). `cpuEvents` / `officialCpu`·`fastCpu` filled with Ir; `wallMs` display-only.
- Harness: `harness/lib/deterministic.mjs`, `harness/ir-worker.mjs`, `bin/pe_count`; measure + bench-ab + merge updated; verify **count-ratchet** (suite ×1.05 + per-tool ×1.15).
- Fast truncate: tiny under-limit payloads use split (grep/find Ir parity); large keep `countLinesNoAlloc`.
- Docs: `docs/METRICS.md`, README measured Ir tables, verify skill.

## 0.2.0 — 2026-10-31 (Asia/Taipei)

- **/goal harness-v0.2:** fix `read` small-file regression (`fast <= official×1.05` on `read:small`); large reads not significantly worse.
- Fast truncate: under-limit no-alloc line count; over-limit reuse pre-split lines (skip join→re-split).
- Large fixtures: `fixture/generate-large.mjs` (2k dir, ~2.5MB, truncation-boundary files); gitignored payloads.
- Fair A/B: `harness/bench-ab.mjs` (in-process paired); `results/bench-linux.json` + `bench-linux-large.json`.
- HW counters: probe in measure/bench-ab; `cpuEvents=-1` with commands in `docs/METRICS.md` (perf missing / no cpu PMU).
- Embed demo: `packages/switch-surface.mjs` + `scripts/ab-demo.mjs` (official `path` schema); `docs/ADAPTER.md` five steps.
- macos still SKIP.

## 0.1.0 — 2026-10-31 (Asia/Taipei)

- FULL harness path through Phase 12 on linux.
- Packages: `official-shim`, `fast-tools` (ts-optimize: withFileTypes ls, buffer truncate, sorted rg).
- Harness: `measure.mjs`, `parity.mjs`, `verify.mjs`; bundled `bin/fd` v10.2.0.
- Results: baseline + bench-linux measured; bench-macos SKIP (no Mac host).
- Docs: ADR-0001, ADAPTER, AUDIT-truncation, README (measured only), MIT.
