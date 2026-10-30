#!/usr/bin/env node
import { dirname, join } from "path";
import { fileURLToPath as __fu } from "url";
process.env.PATH = join(dirname(__fu(import.meta.url)), "..", "bin") + ":" + (process.env.PATH || "");
/**
 * Baseline / A/B measurement runner.
 * Primary HW counters unavailable on this box (no perf) → cpuEvents=-1.
 * Also records process.cpuUsage() deltas (µs) in softCpuUs for honesty.
 */
import { performance } from "perf_hooks";
import { writeFile, mkdir, readFile, copyFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(HARNESS_ROOT, "fixture");
const RESULTS = path.join(HARNESS_ROOT, "results");

const mode = process.argv[2] || "official"; // official | fast
const outName = process.argv[3] || `baseline-${mode}.json`;

const toolsMod =
  mode === "fast"
    ? await import("../packages/fast-tools/src/tools.mjs")
    : await import("../packages/official-shim/src/tools.mjs");

function peakRssKb() {
  // Linux: /proc/self/status VmHWM; fallback rss
  try {
    const fs = require("fs");
  } catch {}
  return Math.round(process.memoryUsage().rss / 1024);
}

async function readPeakRssKb() {
  try {
    const { readFileSync } = await import("fs");
    const st = readFileSync("/proc/self/status", "utf8");
    const m = st.match(/VmHWM:\s+(\d+)/);
    if (m) return Number(m[1]);
  } catch {}
  return Math.round(process.memoryUsage().rss / 1024);
}

async function measureOne(name, fn, rounds = 5) {
  // warmup
  await fn();
  const walls = [];
  let softCpuUs = 0;
  for (let i = 0; i < rounds; i++) {
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    await fn();
    const t1 = performance.now();
    const cpu1 = process.cpuUsage(cpu0);
    walls.push(t1 - t0);
    softCpuUs += cpu1.user + cpu1.system;
  }
  walls.sort((a, b) => a - b);
  const wallMs = walls[Math.floor(walls.length / 2)]; // median
  return {
    tool: name,
    cpuEvents: -1, // HW counters unavailable
    softCpuUs: Math.round(softCpuUs / rounds),
    wallMs: Math.round(wallMs * 1000) / 1000,
    peakRssKb: await readPeakRssKb(),
    binaryBytes: -1,
    env: `${os.type()} ${os.release()} ${os.arch()} node${process.version} rounds=${rounds}`,
    notes: "cpuEvents=-1: linux-perf/HW counters not available on box; softCpuUs=process.cpuUsage user+system µs median-round avg",
  };
}

async function prepEditTarget() {
  const src = path.join(FIXTURE, "edit_sandbox", "target.txt");
  const dst = path.join(FIXTURE, "edit_sandbox", `target_${mode}.txt`);
  await copyFile(src, dst);
  return dst;
}

await mkdir(RESULTS, { recursive: true });

const editTargetRel = `edit_sandbox/target_${mode}.txt`;
await prepEditTarget();

const scenarios = {
  read: () => toolsMod.toolRead(FIXTURE, { filePath: "boundary/lines_2500.txt" }),
  bash: () => toolsMod.toolBash(FIXTURE, { command: "seq 1 3000" }),
  edit: async () => {
    // reset file each call for stable work
    const p = path.join(FIXTURE, editTargetRel);
    await writeFile(p, "alpha\nbeta\ngamma\n");
    return toolsMod.toolEdit(FIXTURE, { filePath: editTargetRel, edits: [{ oldText: "beta", newText: "BETA" }] });
  },
  write: () =>
    toolsMod.toolWrite(FIXTURE, {
      filePath: `write_sandbox/out_${mode}.txt`,
      content: "hello harness\n".repeat(100),
    }),
  grep: () => toolsMod.toolGrep(FIXTURE, { pattern: "ALPHA", path: "src/js" }),
  find: () => toolsMod.toolFind(FIXTURE, { pattern: "*.js", path: "src" }),
  ls: () => toolsMod.toolLs(FIXTURE, { dirPath: "src/js" }),
};

const rows = [];
for (const [name, fn] of Object.entries(scenarios)) {
  try {
    const row = await measureOne(name, fn);
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (e) {
    console.error("FAIL", name, e);
    rows.push({
      tool: name,
      cpuEvents: -1,
      wallMs: -1,
      peakRssKb: -1,
      binaryBytes: -1,
      env: os.type(),
      notes: String(e && e.message ? e.message : e),
    });
  }
}

const out = {
  mode,
  platform: "linux",
  pin: "86dc686cf2fd795b2b24af3d614bb0e1307bcd76",
  fixture: FIXTURE,
  measuredAt: new Date().toISOString(),
  rows,
};
const outPath = path.join(RESULTS, outName);
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath);
