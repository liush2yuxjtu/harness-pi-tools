# Adapter Design · embed A/B + standalone

## switchSurface

Environment variable **`HARNESS_TOOLS=official|fast`** (default `official`).

- Measure: `node harness/measure.mjs official|fast`
- Parity: imports both modules side-by-side
- Embed sketch: coding-agent tool factory selects `fast-tools` when `HARNESS_TOOLS=fast` while keeping the same parameter schema.

## embedPlan

1. Keep tool **names + TypeBox-shaped params** identical to pin.
2. Swap only the execute implementation module:
   - official → `packages/official-shim` (faithful TS port of pin semantics for harness)
   - fast → `packages/fast-tools` (ts-optimize: withFileTypes ls, buffer truncate, sorted rg for stable A/B)
3. Do **not** mutate `/workspace/earendil-pi` pin tree.

## standalonePlan

```bash
cd /workspace/harness-pi-tools
node harness/parity.mjs
node harness/measure.mjs official
node harness/measure.mjs fast
node harness/verify.mjs
```

Bundled `bin/fd` (sharkdp/fd v10.2.0) is prepended to PATH by harness scripts when system `fd` is missing.

## Notes

- Harness grep adds `--sort path` for deterministic A/B (official upstream ripgrep JSON stream is unordered). Documented — not a silent semantic claim of upstream identity on match order.
