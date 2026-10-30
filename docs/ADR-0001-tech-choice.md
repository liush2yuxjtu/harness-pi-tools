# ADR-0001 · Tech choice for Pi tool acceleration

- Status: Accepted
- Date: 2026-10-31 (Asia/Taipei)
- Pin: `86dc686cf2fd795b2b24af3d614bb0e1307bcd76`

## Context

Baseline (linux box, `results/baseline-official.json`): HW counters unavailable (`cpuEvents=-1`); soft CPU + wall measured. Hotspots from Phase 5: `ls` per-entry `stat`, truncate string splits, spawn-bound grep/find.

## Options

| choice | summary |
|---|---|
| rust-bin | Native truncate / ls via Rust (forbid `unsafe`) |
| ts-optimize | Stay in Node; optimize hot JS paths; keep `rg`/`fd` |
| hybrid | TS tools + optional native truncate later |

## Decision

**ts-optimize** (with room to add native later under forbidUnsafe).

### Rationale (evidence-linked)

1. **ls** official softCpuUs≈3221µs / wall≈2.3ms vs fast withFileTypes softCpuUs≈299µs / wall≈0.21ms on same fixture (`src/js` ~120 entries) — primary win without Rust.
2. grep/find already delegate to mature native CLIs; rewriting in Rust duplicates `rg`/`fd`.
3. Empty `native/fast-truncate` scaffold kept for a future hybrid step; not required for v1 parity.

### Constraints

- `forbidUnsafe`: N/A for pure TS; if Rust added later → **must** be true.
- Schema / truncation defaults stay official (2000 / 50KB); raise only via env (AUDIT recommended `env-config`).

## Consequences

- Deliverable is JS packages under `packages/official-shim` + `packages/fast-tools`.
- README claims only measured linux rows; macos SKIP until a Mac host is available.
