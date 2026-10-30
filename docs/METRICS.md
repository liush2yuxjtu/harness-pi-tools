# Metrics · wall / soft CPU / HW counters

## What we record

| field | meaning |
|---|---|
| `wallMs` | median of 5 rounds after 1 warmup (`performance.now`) |
| `softCpuUs` | average `process.cpuUsage` user+system µs over those rounds |
| `cpuEvents` | HW performance-counter events (instructions:u) when available; else **-1** |
| `peakRssKb` | Linux `VmHWM` from `/proc/self/status` when present |

## HW counter probe (every `measure.mjs` run)

`harness/measure.mjs` records probe results under `hw.probes` in the baseline JSON:

```bash
command -v perf
cat /proc/sys/kernel/perf_event_paranoid
perf stat -e instructions:u -x, -- true
ls /sys/bus/event_source/devices
```

### This box (typical SKIP)

- `perf` binary: **not installed** (`command -v perf` empty)
- `/sys/bus/event_source/devices`: present but often **no `cpu` PMU** in constrained VMs
- Result: `cpuEvents=-1` on every row; `notes` repeats the probe summary; rely on `softCpuUs` + `wallMs`

### How to get real cpuEvents later

1. Install `linux-tools-$(uname -r)` or distro `linux-perf`.
2. Ensure paranoid ≤ 2 for user events (or run with sufficient caps).
3. Re-run `node harness/measure.mjs official` — when `hw.available=true`, notes flip; a future revision can sample per-op via `perf stat -e instructions:u -- node …`.

## Suites

```bash
node harness/measure.mjs official baseline-official.json --suite small
node harness/measure.mjs fast baseline-fast.json --suite small
node harness/measure.mjs official baseline-official-large.json --suite large
node harness/measure.mjs fast baseline-fast-large.json --suite large
node harness/merge-bench.mjs results/baseline-official.json results/baseline-fast.json results/bench-linux.json
node harness/merge-bench.mjs results/baseline-official-large.json results/baseline-fast-large.json results/bench-linux-large.json
```

Large fixtures: `node fixture/generate-large.mjs` (gitignored payloads).

## Fair A/B

Prefer `node harness/bench-ab.mjs --suite small|large` for README numbers (in-process paired rounds). `measure.mjs` remains for single-mode baselines required by verify artifacts.
