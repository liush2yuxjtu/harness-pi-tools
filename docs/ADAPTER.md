# Adapter Design · embed A/B + standalone

## switchSurface

Environment variable **`HARNESS_TOOLS=official|fast`** (default `official`).

- Module: `packages/switch-surface.mjs` → `createToolFns(cwd)` / `resolveMode()`
- Measure: `node harness/measure.mjs official|fast [out.json] [--suite small|large|all]`
- Parity: imports both modules side-by-side
- Demo CLI: `node scripts/ab-demo.mjs`

## Official schema alignment (pin `86dc686`)

coding-agent TypeBox params use **`path`** (not `filePath`). switch-surface accepts official names and maps to harness internals:

| tool | official params |
|---|---|
| read | `{ path, offset?, limit? }` |
| ls | `{ path?, limit? }` |
| write / edit | `{ path, … }` |
| grep / find | `{ pattern, path?, … }` |
| bash | `{ command }` |

## Embed plan (do not mutate `/workspace/earendil-pi`)

1. Keep tool **names + TypeBox-shaped params** identical to pin.
2. In your agent factory, select implementation via `HARNESS_TOOLS`:
   - `official` → `packages/official-shim`
   - `fast` → `packages/fast-tools`
3. Or call `createToolFns(cwd)` from `packages/switch-surface.mjs` and wire those functions behind the same tool names.

## Standalone A/B — five copy/paste steps

```bash
# 1) enter repo
cd /workspace/harness-pi-tools

# 2) official surface
export HARNESS_TOOLS=official
node scripts/ab-demo.mjs ls --path src/js

# 3) fast surface (same args / schema)
HARNESS_TOOLS=fast node scripts/ab-demo.mjs ls --path src/js

# 4) timed A/B (median of 5)
HARNESS_TOOLS=official node scripts/ab-demo.mjs --bench ls --path src/js
HARNESS_TOOLS=fast     node scripts/ab-demo.mjs --bench ls --path src/js

# 5) read boundary + optional large suite measure
node scripts/ab-demo.mjs read --path boundary/lines_2500.txt
node fixture/generate-large.mjs   # once
node harness/measure.mjs official /tmp/o.json --suite large
node harness/measure.mjs fast     /tmp/f.json --suite large
```

## Full harness loop

```bash
cd /workspace/harness-pi-tools
node harness/parity.mjs
node harness/measure.mjs official baseline-official.json --suite small
node harness/measure.mjs fast baseline-fast.json --suite small
node harness/merge-bench.mjs
node harness/verify.mjs
```

Bundled `bin/fd` (sharkdp/fd v10.2.0) is prepended to PATH by harness scripts when system `fd` is missing.

## Notes

- Harness grep adds `--sort path` for deterministic A/B (official upstream ripgrep JSON stream is unordered). Documented — not a silent semantic claim of upstream identity on match order.
- True in-process swap inside a live `earendil-pi` coding-agent build is an embed of this surface (same names/params); this repo does not patch the pin tree.
