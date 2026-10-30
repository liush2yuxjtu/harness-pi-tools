---
name: verify
description: Run HARNESS verify gate for pi-tools acceleration (pin, parity, artifacts, docs).
---

# /verify

From `/workspace/harness-pi-tools`:

```bash
node harness/verify.mjs
```

PASS requires: pin match, parity.json passed, baseline/bench-linux present, ADR/ADAPTER/AUDIT/METRICS docs, no `unsafe`, fd available. macos bench may be SKIP if documented in `results/bench-macos.json`.

FAIL/BLOCKED → do not write performance claims or commit.
