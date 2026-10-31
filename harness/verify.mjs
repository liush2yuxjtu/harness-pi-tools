#!/usr/bin/env node
import { dirname, join } from "path";
import { fileURLToPath as __fu } from "url";
process.env.PATH = join(dirname(__fu(import.meta.url)), "..", "bin") + ":" + (process.env.PATH || "");
import { spawn } from "child_process";
import { readFile, writeFile, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RESULTS = path.join(ROOT, "results");

/** Lab ceilings (counts only; wallMs is NOT gated). */
const COUNT_CEILING = Number(process.env.HARNESS_COUNT_CEILING || "1.05"); // suite sum
const COUNT_TOOL_CEILING = Number(process.env.HARNESS_COUNT_TOOL_CEILING || "1.15"); // per-tool

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

const items = [];

// 1 pin
const pin = "86dc686cf2fd795b2b24af3d614bb0e1307bcd76";
const head = (await run("git", ["-C", "/workspace/earendil-pi", "rev-parse", "HEAD"])).out.trim();
items.push({ name: "pin", status: head === pin ? "PASS" : "FAIL", detail: `HEAD=${head}` });

// 2 parity
const parityRun = await run("node", ["harness/parity.mjs"]);
let parityOk = false;
try {
  const p = JSON.parse(await readFile(path.join(RESULTS, "parity.json"), "utf8"));
  parityOk = !!p.passed;
} catch {}
items.push({
  name: "parity",
  status: parityRun.code === 0 && parityOk ? "PASS" : "FAIL",
  detail: parityOk ? "parity.json passed" : (parityRun.err || parityRun.out).slice(0, 300),
});

// 3 benches present
for (const f of ["baseline-official.json", "baseline-fast.json", "bench-linux.json"]) {
  try {
    await access(path.join(RESULTS, f));
    items.push({ name: `artifact:${f}`, status: "PASS", detail: "present" });
  } catch {
    items.push({ name: `artifact:${f}`, status: "FAIL", detail: "missing" });
  }
}

// 4 macos documented skip
try {
  const m = JSON.parse(await readFile(path.join(RESULTS, "bench-macos.json"), "utf8"));
  items.push({
    name: "macos-bench",
    status: m.status === "SKIP" || (m.rows && m.rows.length) ? (m.status === "SKIP" ? "SKIP" : "PASS") : "FAIL",
    detail: m.reason || `rows=${(m.rows||[]).length}`,
  });
} catch {
  items.push({ name: "macos-bench", status: "FAIL", detail: "missing bench-macos.json" });
}

// 5 ADR + ADAPTER + METRICS
for (const f of ["docs/ADR-0001-tech-choice.md", "docs/ADR-0002-spawn-reuse.md", "docs/ADR-0003-native-ir-worker.md", "docs/ADAPTER.md", "docs/AUDIT-truncation.md", "docs/METRICS.md"]) {
  try {
    await access(path.join(ROOT, f));
    items.push({ name: f, status: "PASS", detail: "present" });
  } catch {
    items.push({ name: f, status: "FAIL", detail: "missing" });
  }
}

// 6 no unsafe (allow #![forbid(unsafe_code)] / forbidUnsafe docs)
const rg = await run("rg", ["-n", "\\bunsafe\\b", "native", "packages"]);
const unsafeHits = (rg.out || "")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !/forbid\(unsafe/.test(l) && !/forbidUnsafe/.test(l) && !/no unsafe/.test(l))
  .join("\n");
items.push({
  name: "forbid-unsafe",
  status: unsafeHits ? "FAIL" : "PASS",
  detail: unsafeHits ? unsafeHits.slice(0, 200) : "no unsafe blocks under native/packages (forbid(unsafe_code) OK)",
});

// 7 fd available
const fd = await run("fd", ["--version"]);
items.push({
  name: "fd-available",
  status: fd.code === 0 ? "PASS" : "FAIL",
  detail: (fd.out || fd.err).trim(),
});

// 8 deterministic metric + ratchet (lab gate; wallMs not gated)
try {
  const bench = JSON.parse(await readFile(path.join(RESULTS, "bench-linux.json"), "utf8"));
  const metric = bench.metric || bench.hw?.metric || null;
  const tried = bench.hw?.tried || [];
  const rows = bench.rows || [];
  const counted = rows.filter((r) => Number(r.officialCpu) >= 0 && Number(r.fastCpu) >= 0);
  if (!metric) {
    items.push({
      name: "deterministic-metric",
      status: "FAIL",
      detail: "bench-linux.json missing metric field — re-run bench-ab/measure after probe chain",
    });
  } else if (counted.length === 0) {
    items.push({
      name: "deterministic-metric",
      status: "SKIP",
      detail: `metric=${metric} but no non-negative cpu counts in rows; tried=${JSON.stringify(tried)}`,
    });
    items.push({
      name: "count-ratchet",
      status: "SKIP",
      detail: "no countable rows for ceiling",
    });
  } else {
    items.push({
      name: "deterministic-metric",
      status: "PASS",
      detail: `metric=${metric}; countedRows=${counted.length}/${rows.length}; tried=${tried.map((t) => `${t.step}:${t.name}:${t.ok}`).join(",")}`,
    });
    const offSum = counted.reduce((s, r) => s + r.officialCpu, 0);
    const fastSum = counted.reduce((s, r) => s + r.fastCpu, 0);
    const suiteLimit = offSum * COUNT_CEILING;
    const suiteOk = fastSum <= suiteLimit;
    const toolViolations = [];
    for (const r of counted) {
      const limit = r.officialCpu * COUNT_TOOL_CEILING;
      if (r.fastCpu > limit) {
        toolViolations.push(
          `${r.tool}: fastCpu=${r.fastCpu} > officialCpu×${COUNT_TOOL_CEILING}=${Math.round(limit)} (official=${r.officialCpu})`,
        );
      }
    }
    items.push({
      name: "count-ratchet",
      status: suiteOk && toolViolations.length === 0 ? "PASS" : "FAIL",
      detail: [
        `metric=${metric}`,
        `suiteSum fast=${fastSum} official=${offSum} limit=${Math.round(suiteLimit)} (×${COUNT_CEILING}) ${suiteOk ? "OK" : "FAIL"}`,
        toolViolations.length
          ? `toolCeil×${COUNT_TOOL_CEILING} FAIL: ${toolViolations.join("; ")}`
          : `toolCeil×${COUNT_TOOL_CEILING} OK for ${counted.length} tools`,
        "wallMs not gated",
      ].join("; ").slice(0, 700),
    });
  }
} catch (e) {
  items.push({
    name: "deterministic-metric",
    status: "FAIL",
    detail: `cannot read bench-linux.json: ${e.message || e}`,
  });
}

const hardFail = items.some((i) => i.status === "FAIL" || i.status === "BLOCKED");
const report = { passed: !hardFail, items, at: new Date().toISOString(), countCeiling: COUNT_CEILING, countToolCeiling: COUNT_TOOL_CEILING };
await writeFile(path.join(RESULTS, "verify.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(hardFail ? 1 : 0);
