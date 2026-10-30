---
name: verify
description: Run HARNESS verify gate for pi-tools acceleration (pin, parity, artifacts, docs, deterministic count ratchet).
---

# /verify

From `/workspace/harness-pi-tools`:

```bash
node harness/verify.mjs
```

PASS requires: pin match, parity.json passed, baseline/bench-linux present, ADR/ADAPTER/AUDIT/METRICS docs, no `unsafe`, fd available, deterministic `metric` on bench-linux with countable rows, and **count-ratchet** (`sum(fastCpu) <= sum(officialCpu)×1.05` and each tool `fastCpu <= officialCpu×1.15` by default). wallMs is **not** a lab gate. macos bench may be SKIP if documented in `results/bench-macos.json`.

FAIL/BLOCKED → do not write performance claims or commit.
