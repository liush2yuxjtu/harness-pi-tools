# Metrics · deterministic counts (lab) + wall (display)

## Roles

| field | role | meaning |
|---|---|---|
| `cpuEvents` / `officialCpu`·`fastCpu` | **Lab / CI primary** | Deterministic (or best-effort) event count selected by the probe chain |
| `metric` | Lab | Which counter won: `perf-instructions` → `valgrind-ir` → `page-faults` → `soft-cpu-proxy` |
| `wallMs` | **Display / fair A/B only** | Median wall time — **not** the lab ratchet gate |
| `softCpuUs` | Secondary | `process.cpuUsage` user+system µs (avg); also feeds soft-cpu-proxy |
| `peakRssKb` | Required report | Linux `VmHWM` when present |
| `countStability` | When soft/Ir repeats | `{ n, median, min, max, cv }` over N samples |

## Probe chain (every measure / bench-ab)

Implemented in `harness/lib/deterministic.mjs`. First success wins:

1. **perf / pe_count HW instructions** (`instructions:u` / `PERF_COUNT_HW_INSTRUCTIONS`)
2. **Valgrind cachegrind `Ir`** with real Node ELF + `node --predictable` (`harness/ir-worker.mjs`)
3. **Other non-wall events** (`bin/pe_count page_faults`)
4. **soft-cpu-proxy** — median `process.cpuUsage` µs; still written into `cpuEvents` so verify can ratchet; document `countStability.cv`

Results JSON stores `hw.tried`, `hw.probes`, and top-level `metric`.

### This box (2026-10-31 Asia/Taipei)

- No `cpu` PMU under `/sys/bus/event_source/devices` → HW instructions **SKIP** (`ENOENT` / no PMU)
- Distro `perf` may be present but broken (missing `.so`); `bin/pe_count` is the local openat helper
- **`valgrind-ir` wins** after installing `valgrind` + `libc6-dbg`
- `wallMs` still recorded for README tables; verify **does not** gate on wall

### SKIP rules

- A step is SKIP/failed only after it was attempted and recorded in `hw.tried` / `hw.probes`
- Lab gate SKIP for counts only if **every** hard path failed **and** soft proxy produced no finite counts (should not happen)
- macOS bench remains a platform SKIP when no Mac host (`results/bench-macos.json`)

## Collecting

```bash
# Fair A/B (preferred for README + verify artifact)
node harness/bench-ab.mjs --suite small --rounds 31 --ir-rounds 25
node harness/bench-ab.mjs --suite large --rounds 21 --ir-rounds 15

# Single-mode baselines (verify artifacts)
node harness/measure.mjs official baseline-official.json --suite small --ir-rounds 25
node harness/measure.mjs fast baseline-fast.json --suite small --ir-rounds 25
node harness/measure.mjs official baseline-official-large.json --suite large --ir-rounds 15
node harness/measure.mjs fast baseline-fast-large.json --suite large --ir-rounds 15

# Optional merge (bench-ab already writes bench-linux*.json)
node harness/merge-bench.mjs results/baseline-official.json results/baseline-fast.json results/bench-linux.json
```

Valgrind Ir is slow (full process instrumentation + `--trace-children=yes`). `ir-rounds` amortizes Node startup by repeating the tool call inside one worker; Ir = sum of cachegrind `summary:` across parent and children.

## Verify ratchet

`harness/verify.mjs`:

- `deterministic-metric` — `bench-linux.json` has a `metric` and countable rows
- `count-ratchet`:
  - **Suite sum:** `sum(fastCpu) <= sum(officialCpu) × HARNESS_COUNT_CEILING` (default **1.05**)
  - **Per-tool:** each tool `fastCpu <= officialCpu × HARNESS_COUNT_TOOL_CEILING` (default **1.15**)
- Valgrind Ir uses `--trace-children=yes` and **sums** all `summary:` lines in per-PID cachegrind outs (parent Node + `rg`/`fd`/`bash` children)
- **`wallMs` is not gated**

## Suites

Large fixtures: `node fixture/generate-large.mjs` (gitignored payloads).
