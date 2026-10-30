#!/usr/bin/env node
/**
 * Fair in-process A/B for wall/soft + out-of-process deterministic counts (Valgrind Ir / …).
 * Usage: node harness/bench-ab.mjs [--suite small|large|all] [--rounds 31] [--ir-rounds 25] [--out results/bench-linux.json]
 */
import { dirname, join } from "path";
import { fileURLToPath as __fu } from "url";
process.env.PATH = join(dirname(__fu(import.meta.url)), "..", "bin") + ":" + (process.env.PATH || "");

import { performance } from "perf_hooks";
import { writeFile, mkdir, copyFile, access } from "fs/promises";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import * as Official from "../packages/official-shim/src/tools.mjs";
import * as Fast from "../packages/fast-tools/src/tools.mjs";
import { probeDeterministicMetric, measureValgrindIr, measureSoftCpuProxy, stabilityStats } from "./lib/deterministic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "fixture");
const RESULTS = path.join(ROOT, "results");
const IR_WORKER = path.join(ROOT, "harness", "ir-worker.mjs");

const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}
const suite = flag("suite", "small");
const rounds = Number(flag("rounds", "31"));
const irRounds = Number(flag("ir-rounds", process.env.HARNESS_IR_ROUNDS || "25"));
const irRepeats = Number(flag("ir-repeats", process.env.HARNESS_IR_REPEATS || "1"));
const outName = flag("out", suite === "large" ? "bench-linux-large.json" : "bench-linux.json");
const skipIr = argv.includes("--skip-ir");

async function ensureLarge() {
  try {
    await access(path.join(FIXTURE, "large", "dir_2k", ".generated"));
  } catch {
    const r = spawnSync(process.execPath, [path.join(FIXTURE, "generate-large.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("generate-large failed");
  }
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

async function pairedWallSoft(offFn, fastFn) {
  for (let i = 0; i < 5; i++) {
    await offFn();
    await fastFn();
  }
  const offWalls = [],
    fastWalls = [];
  let offSoft = 0,
    fastSoft = 0;
  const offSoftSamples = [],
    fastSoftSamples = [];
  for (let i = 0; i < rounds; i++) {
    let cpu0 = process.cpuUsage();
    let t0 = performance.now();
    await offFn();
    offWalls.push(performance.now() - t0);
    let c1 = process.cpuUsage(cpu0);
    offSoft += c1.user + c1.system;
    offSoftSamples.push(c1.user + c1.system);

    cpu0 = process.cpuUsage();
    t0 = performance.now();
    await fastFn();
    fastWalls.push(performance.now() - t0);
    c1 = process.cpuUsage(cpu0);
    fastSoft += c1.user + c1.system;
    fastSoftSamples.push(c1.user + c1.system);
  }
  return {
    officialSoftCpuUs: Math.round(offSoft / rounds),
    fastSoftCpuUs: Math.round(fastSoft / rounds),
    officialSoftMedian: median(offSoftSamples),
    fastSoftMedian: median(fastSoftSamples),
    officialWallMs: Math.round(median(offWalls) * 1000) / 1000,
    fastWallMs: Math.round(median(fastWalls) * 1000) / 1000,
    softStability: {
      official: stabilityStats(offSoftSamples),
      fast: stabilityStats(fastSoftSamples),
    },
  };
}

await mkdir(RESULTS, { recursive: true });
if (suite === "large" || suite === "all") await ensureLarge();

const hw = probeDeterministicMetric();
console.error("metric probe:", JSON.stringify({ metric: hw.metric, available: hw.available, tried: hw.tried }, null, 2));

await copyFile(path.join(FIXTURE, "edit_sandbox/target.txt"), path.join(FIXTURE, "edit_sandbox/target_ab_off.txt"));
await copyFile(path.join(FIXTURE, "edit_sandbox/target.txt"), path.join(FIXTURE, "edit_sandbox/target_ab_fast.txt"));

const small = {
  "read:small": [
    () => Official.toolRead(FIXTURE, { filePath: "src/js/hello.js" }),
    () => Fast.toolRead(FIXTURE, { filePath: "src/js/hello.js" }),
  ],
  "read:boundary-lines": [
    () => Official.toolRead(FIXTURE, { filePath: "boundary/lines_2500.txt" }),
    () => Fast.toolRead(FIXTURE, { filePath: "boundary/lines_2500.txt" }),
  ],
  bash: [
    () => Official.toolBash(FIXTURE, { command: "seq 1 3000" }),
    () => Fast.toolBash(FIXTURE, { command: "seq 1 3000" }),
  ],
  edit: [
    async () => {
      await writeFile(path.join(FIXTURE, "edit_sandbox/target_ab_off.txt"), "alpha\nbeta\ngamma\n");
      return Official.toolEdit(FIXTURE, {
        filePath: "edit_sandbox/target_ab_off.txt",
        edits: [{ oldText: "beta", newText: "BETA" }],
      });
    },
    async () => {
      await writeFile(path.join(FIXTURE, "edit_sandbox/target_ab_fast.txt"), "alpha\nbeta\ngamma\n");
      return Fast.toolEdit(FIXTURE, {
        filePath: "edit_sandbox/target_ab_fast.txt",
        edits: [{ oldText: "beta", newText: "BETA" }],
      });
    },
  ],
  write: [
    () => Official.toolWrite(FIXTURE, { filePath: "write_sandbox/out_ab_off.txt", content: "hello harness\n".repeat(100) }),
    () => Fast.toolWrite(FIXTURE, { filePath: "write_sandbox/out_ab_fast.txt", content: "hello harness\n".repeat(100) }),
  ],
  grep: [
    () => Official.toolGrep(FIXTURE, { pattern: "ALPHA", path: "src/js" }),
    () => Fast.toolGrep(FIXTURE, { pattern: "ALPHA", path: "src/js" }),
  ],
  find: [
    () => Official.toolFind(FIXTURE, { pattern: "*.js", path: "src" }),
    () => Fast.toolFind(FIXTURE, { pattern: "*.js", path: "src" }),
  ],
  ls: [
    () => Official.toolLs(FIXTURE, { dirPath: "src/js" }),
    () => Fast.toolLs(FIXTURE, { dirPath: "src/js" }),
  ],
};

const large = {
  "read:large-2mb": [
    () => Official.toolRead(FIXTURE, { filePath: "large/big_2_5mb.txt" }),
    () => Fast.toolRead(FIXTURE, { filePath: "large/big_2_5mb.txt" }),
  ],
  "read:near-2000": [
    () => Official.toolRead(FIXTURE, { filePath: "large/near_2000_lines.txt" }),
    () => Fast.toolRead(FIXTURE, { filePath: "large/near_2000_lines.txt" }),
  ],
  "read:near-50kb": [
    () => Official.toolRead(FIXTURE, { filePath: "large/near_50kb.txt" }),
    () => Fast.toolRead(FIXTURE, { filePath: "large/near_50kb.txt" }),
  ],
  "ls:dir-2k": [
    () => Official.toolLs(FIXTURE, { dirPath: "large/dir_2k" }),
    () => Fast.toolLs(FIXTURE, { dirPath: "large/dir_2k" }),
  ],
  "find:dir-2k": [
    () => Official.toolFind(FIXTURE, { pattern: "*.txt", path: "large/dir_2k" }),
    () => Fast.toolFind(FIXTURE, { pattern: "*.txt", path: "large/dir_2k" }),
  ],
  "grep:large-2mb": [
    () => Official.toolGrep(FIXTURE, { pattern: "ALPHA", path: "large/big_2_5mb.txt" }),
    () => Fast.toolGrep(FIXTURE, { pattern: "ALPHA", path: "large/big_2_5mb.txt" }),
  ],
};

const scenarios = suite === "large" ? large : suite === "all" ? { ...small, ...large } : small;
const rows = [];
for (const [name, [o, f]] of Object.entries(scenarios)) {
  const ws = await pairedWallSoft(o, f);
  let officialCpu = -1;
  let fastCpu = -1;
  let countStability = null;

  if (!skipIr && hw.metric === "valgrind-ir") {
    const offIr = measureValgrindIr({
      workerPath: IR_WORKER,
      workerArgs: ["official", name, String(irRounds)],
      repeats: irRepeats,
    });
    const fastIr = measureValgrindIr({
      workerPath: IR_WORKER,
      workerArgs: ["fast", name, String(irRounds)],
      repeats: irRepeats,
    });
    officialCpu = offIr.ir;
    fastCpu = fastIr.ir;
    countStability = { official: offIr.stability, fast: fastIr.stability };
  } else if (hw.metric === "soft-cpu-proxy" || hw.softProxy || hw.metric === "page-faults" || hw.metric === "perf-instructions") {
    // Use soft median as ratchetable lab count when hard Ir unavailable
    officialCpu = ws.officialSoftMedian;
    fastCpu = ws.fastSoftMedian;
    countStability = ws.softStability;
  }

  const row = {
    tool: name,
    metric: hw.metric,
    officialCpu,
    fastCpu,
    officialSoftCpuUs: ws.officialSoftCpuUs,
    fastSoftCpuUs: ws.fastSoftCpuUs,
    officialWallMs: ws.officialWallMs,
    fastWallMs: ws.fastWallMs,
    officialRssKb: -1,
    fastRssKb: -1,
    binaryBytes: -1,
    countStability,
  };
  rows.push(row);
  const irRatio = officialCpu > 0 && fastCpu > 0 ? Math.round((officialCpu / fastCpu) * 100) / 100 : null;
  console.log(
    JSON.stringify({
      tool: name,
      metric: hw.metric,
      officialCpu,
      fastCpu,
      irRatio,
      gateIr05: officialCpu > 0 && fastCpu > 0 ? fastCpu <= officialCpu * 1.05 : null,
      officialWallMs: row.officialWallMs,
      fastWallMs: row.fastWallMs,
      wallRatio: Math.round((row.officialWallMs / row.fastWallMs) * 100) / 100,
    }),
  );
}

const out = {
  platform: "linux",
  pin: "86dc686cf2fd795b2b24af3d614bb0e1307bcd76",
  suite,
  measuredAt: new Date().toISOString(),
  metric: hw.metric,
  env: `${os.type()} ${os.release()} ${os.arch()} node${process.version} rounds=${rounds} irRounds=${irRounds} paired=in-process+${hw.metric}`,
  notes: hw.notes,
  hw: {
    available: hw.available,
    metric: hw.metric,
    sample: hw.sample ?? null,
    tried: hw.tried,
    probes: hw.probes,
    softProxy: Boolean(hw.softProxy),
  },
  rows,
};
const finalOut = path.isAbsolute(outName)
  ? outName
  : outName.includes("/")
    ? path.join(ROOT, outName)
    : path.join(RESULTS, outName);
await mkdir(path.dirname(finalOut), { recursive: true });
await writeFile(finalOut, JSON.stringify(out, null, 2));
console.log("wrote", finalOut);
