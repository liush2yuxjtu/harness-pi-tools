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

// 5 ADR + ADAPTER
for (const f of ["docs/ADR-0001-tech-choice.md", "docs/ADAPTER.md", "docs/AUDIT-truncation.md"]) {
  try {
    await access(path.join(ROOT, f));
    items.push({ name: f, status: "PASS", detail: "present" });
  } catch {
    items.push({ name: f, status: "FAIL", detail: "missing" });
  }
}

// 6 no unsafe in native (if any rust)
const rg = await run("rg", ["-n", "\\bunsafe\\b", "native", "packages"]);
const unsafeHits = (rg.out || "").trim();
items.push({
  name: "forbid-unsafe",
  status: unsafeHits ? "FAIL" : "PASS",
  detail: unsafeHits ? unsafeHits.slice(0, 200) : "no unsafe keyword under native/packages",
});

// 7 fd available
const fd = await run("fd", ["--version"]);
items.push({
  name: "fd-available",
  status: fd.code === 0 ? "PASS" : "FAIL",
  detail: (fd.out || fd.err).trim(),
});

const hardFail = items.some((i) => i.status === "FAIL" || i.status === "BLOCKED");
const report = { passed: !hardFail, items, at: new Date().toISOString() };
await writeFile(path.join(RESULTS, "verify.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(hardFail ? 1 : 0);
