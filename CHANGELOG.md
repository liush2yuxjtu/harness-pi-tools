# Changelog

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
