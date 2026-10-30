# harness-pi-tools

Accelerate official Pi (`earendil-works/pi`) coding-agent base tools for a portfolio A/B demo.

**Status:** verify PASS · parity PASS · pin `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` · v0.2.0

License: MIT

## What this is

- **Pin:** `/workspace/earendil-pi` @ `86dc686`
- **Official shim:** `packages/official-shim` — faithful TS port for harness runners
- **Fast path:** `packages/fast-tools` — `ts-optimize` (see `docs/ADR-0001-tech-choice.md`)
- **Switch:** `HARNESS_TOOLS=official|fast` via `packages/switch-surface.mjs` / `scripts/ab-demo.mjs`

## Measured A/B (linux)

Fair in-process paired A/B (`node harness/bench-ab.mjs`).  
Primary metric CPU events: unavailable (`cpuEvents=-1`). Secondary: `softCpuUs`, `wallMs` = median after warmups.  
See `docs/METRICS.md` for HW probe commands.

### Small suite — `results/bench-linux.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=41 paired=in-process`  
Measured at: `2026-10-30T22:44:42.935Z` (UTC in file; Asia/Taipei = +8)  
Notes: cpuEvents=-1; HW counters unavailable on this box. Probe commands: command -v perf | cat /proc/sys/kernel/perf_event_paranoid | perf stat -e instructions:u -x, -- true | ls /sys/bus/event_source/devices. Failures: command -v perf: perf not on PATH

| tool | officialCpu | fastCpu | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | wall ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:small | -1 | -1 | 105 | 118 | 0.066 | 0.063 | 1.05x |
| read:boundary-lines | -1 | -1 | 396 | 448 | 0.339 | 0.246 | 1.38x |
| bash | -1 | -1 | 1229 | 1394 | 5.066 | 4.207 | 1.20x |
| edit | -1 | -1 | 320 | 405 | 0.304 | 0.327 | 0.93x |
| write | -1 | -1 | 115 | 124 | 0.124 | 0.158 | 0.78x |
| grep | -1 | -1 | 1011 | 987 | 3.785 | 3.993 | 0.95x |
| find | -1 | -1 | 1087 | 957 | 5.009 | 5.035 | 0.99x |
| ls | -1 | -1 | 1772 | 122 | 1.815 | 0.122 | 14.88x |

Honest notes: `edit` / `write` / `grep` can be slightly slower on this box at sub-ms / spawn-bound scales; `ls` is the primary win. `read:small` meets `fast <= official×1.05`.

### Large suite — `results/bench-linux-large.json`

Env: `Linux 6.12.94+ x64 nodev24.22.1 rounds=21 paired=in-process`  
Measured at: `2026-10-30T22:44:45.137Z` (UTC in file; Asia/Taipei = +8)

Generate once: `node fixture/generate-large.mjs` (payloads gitignored).

| tool | officialCpu | fastCpu | officialSoftCpuUs | fastSoftCpuUs | officialWallMs | fastWallMs | wall ratio (off/fast) |
|---|---:|---:|---:|---:|---:|---:|---:|
| read:large-2mb | -1 | -1 | 7433 | 6982 | 5.463 | 5.535 | 0.99x |
| read:near-2000 | -1 | -1 | 378 | 329 | 0.381 | 0.351 | 1.09x |
| read:near-50kb | -1 | -1 | 300 | 346 | 0.188 | 0.182 | 1.03x |
| ls:dir-2k | -1 | -1 | 8261 | 1076 | 9.167 | 1.05 | 8.73x |
| find:dir-2k | -1 | -1 | 1829 | 1803 | 7.954 | 7.572 | 1.05x |
| grep:large-2mb | -1 | -1 | 23917 | 15537 | 15.785 | 16.391 | 0.96x |


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

## Embed A/B (5 steps)

```bash
cd /workspace/harness-pi-tools
export HARNESS_TOOLS=official
node scripts/ab-demo.mjs ls --path src/js
HARNESS_TOOLS=fast node scripts/ab-demo.mjs ls --path src/js
HARNESS_TOOLS=official node scripts/ab-demo.mjs --bench ls --path src/js
HARNESS_TOOLS=fast     node scripts/ab-demo.mjs --bench ls --path src/js
node scripts/ab-demo.mjs read --path boundary/lines_2500.txt
```

Details: `docs/ADAPTER.md`.

## Docs

- `docs/ADR-0001-tech-choice.md` — ts-optimize
- `docs/ADAPTER.md` — embed + standalone
- `docs/AUDIT-truncation.md` — 2000/50KB
- `docs/METRICS.md` — wall / softCpu / HW probes
- `PRD.md` — product brief

## Fixture

`fixture/` fixed tree + `fixture/generate-large.mjs` for 2k-dir / ~2.5MB loads.

## Bundled tools

`bin/fd` — sharkdp/fd v10.2.0
