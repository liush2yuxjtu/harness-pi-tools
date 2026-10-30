#!/usr/bin/env node
import { dirname, join } from "path";
import { fileURLToPath as __fu } from "url";
process.env.PATH = join(dirname(__fu(import.meta.url)), "..", "bin") + ":" + (process.env.PATH || "");
/**
 * Baseline measurement runner.
 * Lab primary: deterministic event count (perf instructions → Valgrind Ir → other → softCpu proxy).
 * wallMs: secondary / public display — not the lab gate.
 *
 * Usage:
 *   node harness/measure.mjs official|fast [out.json] [--suite small|large|all] [--ir-rounds N]
 */
import { performance } from "perf_hooks";
import { writeFile, mkdir, copyFile, access } from "fs/promises";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import { readFileSync } from "fs";
import {
  probeDeterministicMetric,
  measureValgrindIr,
  measureSoftCpuProxy,
} from "./lib/deterministic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(HARNESS_ROOT, "fixture");
const RESULTS = path.join(HARNESS_ROOT, "results");
const IR_WORKER = path.join(HARNESS_ROOT, "harness", "ir-worker.mjs");

const argv = process.argv.slice(2);
const mode = argv.find((a) => a === "official" || a === "fast") || "official";
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}
const suite = flag("suite", "small");
const irRounds = Number(flag("ir-rounds", process.env.HARNESS_IR_ROUNDS || "25"));
const wallRounds = Number(flag("rounds", "15"));
const outName =
  argv.find(
    (a, i) =>
      a !== "official" &&
      a !== "fast" &&
      !a.startsWith("--") &&
      argv[i - 1] !== "--suite" &&
      argv[i - 1] !== "--ir-rounds" &&
      argv[i - 1] !== "--rounds",
  ) || `baseline-${mode}.json`;

const toolsMod =
  mode === "fast"
    ? await import("../packages/fast-tools/src/tools.mjs")
    : await import("../packages/official-shim/src/tools.mjs");

async function readPeakRssKb() {
  try {
    const st = readFileSync("/proc/self/status", "utf8");
    const m = st.match(/VmHWM:\s+(\d+)/);
    if (m) return Number(m[1]);
  } catch {}
  return Math.round(process.memoryUsage().rss / 1024);
}

async function measureWallSoft(name, fn, rounds = wallRounds) {
  await fn();
  const walls = [];
  let softCpuUs = 0;
  const softSamples = [];
  for (let i = 0; i < rounds; i++) {
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    await fn();
    const t1 = performance.now();
    const cpu1 = process.cpuUsage(cpu0);
    walls.push(t1 - t0);
    const soft = cpu1.user + cpu1.system;
    softCpuUs += soft;
    softSamples.push(soft);
  }
  walls.sort((a, b) => a - b);
  softSamples.sort((a, b) => a - b);
  const wallMs = walls[Math.floor(walls.length / 2)];
  const softMed = softSamples[Math.floor(softSamples.length / 2)];
  return {
    wallMs: Math.round(wallMs * 1000) / 1000,
    softCpuUs: Math.round(softCpuUs / rounds),
    softCpuUsMedian: softMed,
    softSamples,
  };
}

async function ensureLarge() {
  const marker = path.join(FIXTURE, "large", "dir_2k", ".generated");
  try {
    await access(marker);
  } catch {
    const r = spawnSync(process.execPath, [path.join(FIXTURE, "generate-large.mjs")], {
      cwd: HARNESS_ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("generate-large.mjs failed");
  }
}

async function prepEditTarget() {
  const src = path.join(FIXTURE, "edit_sandbox", "target.txt");
  const dst = path.join(FIXTURE, "edit_sandbox", `target_${mode}.txt`);
  await copyFile(src, dst);
  return dst;
}

await mkdir(RESULTS, { recursive: true });
const hw = probeDeterministicMetric();
console.error("metric probe:", JSON.stringify({ metric: hw.metric, available: hw.available, tried: hw.tried }, null, 2));

const editTargetRel = `edit_sandbox/target_${mode}.txt`;
await prepEditTarget();

const smallScenarios = {
  "read:small": () => toolsMod.toolRead(FIXTURE, { filePath: "src/js/hello.js" }),
  "read:boundary-lines": () => toolsMod.toolRead(FIXTURE, { filePath: "boundary/lines_2500.txt" }),
  bash: () => toolsMod.toolBash(FIXTURE, { command: "seq 1 3000" }),
  edit: async () => {
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

const largeScenarios = {
  "read:large-2mb": () => toolsMod.toolRead(FIXTURE, { filePath: "large/big_2_5mb.txt" }),
  "read:near-2000": () => toolsMod.toolRead(FIXTURE, { filePath: "large/near_2000_lines.txt" }),
  "read:near-50kb": () => toolsMod.toolRead(FIXTURE, { filePath: "large/near_50kb.txt" }),
  "ls:dir-2k": () => toolsMod.toolLs(FIXTURE, { dirPath: "large/dir_2k" }),
  "find:dir-2k": () => toolsMod.toolFind(FIXTURE, { pattern: "*.txt", path: "large/dir_2k" }),
  "grep:large-2mb": () => toolsMod.toolGrep(FIXTURE, { pattern: "ALPHA", path: "large/big_2_5mb.txt" }),
};

if (suite === "large" || suite === "all") await ensureLarge();

const scenarios =
  suite === "large" ? largeScenarios : suite === "all" ? { ...smallScenarios, ...largeScenarios } : smallScenarios;

const rows = [];
for (const [name, fn] of Object.entries(scenarios)) {
  try {
    const ws = await measureWallSoft(name, fn);
    let cpuEvents = -1;
    let countStability = null;
    let countNotes = hw.notes;

    if (hw.metric === "valgrind-ir") {
      const ir = measureValgrindIr({
        workerPath: IR_WORKER,
        workerArgs: [mode, name, String(irRounds)],
        repeats: 1,
      });
      cpuEvents = ir.ir;
      countStability = ir.stability;
      countNotes = `${hw.notes}; irRounds=${irRounds} (1 warmup + N in worker)`;
    } else if (hw.metric === "soft-cpu-proxy" || hw.metric === "page-faults") {
      // page-faults path still uses softCpu as ratchetable lab count unless we add pe wrapping later
      const soft = await measureSoftCpuProxy(fn, wallRounds);
      cpuEvents = soft.count;
      countStability = soft.stability;
      countNotes = `${hw.notes}; softProxyRounds=${wallRounds}; stability.cv=${soft.stability.cv}`;
    } else if (hw.metric === "perf-instructions") {
      // future: wrap pe_count around worker; for now soft proxy until per-op pe wired
      const soft = await measureSoftCpuProxy(fn, wallRounds);
      cpuEvents = soft.count;
      countStability = soft.stability;
      countNotes = `${hw.notes}; per-op perf sampling not yet wired → softCpu proxy this row`;
    }

    const row = {
      tool: name,
      metric: hw.metric,
      cpuEvents,
      softCpuUs: ws.softCpuUs,
      wallMs: ws.wallMs,
      peakRssKb: await readPeakRssKb(),
      binaryBytes: -1,
      countStability,
      env: `${os.type()} ${os.release()} ${os.arch()} node${process.version} wallRounds=${wallRounds} irRounds=${irRounds}`,
      notes: countNotes,
    };
    rows.push(row);
    console.log(JSON.stringify({ tool: name, metric: row.metric, cpuEvents, softCpuUs: row.softCpuUs, wallMs: row.wallMs }));
  } catch (e) {
    console.error("FAIL", name, e);
    rows.push({
      tool: name,
      metric: hw.metric,
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
  suite,
  platform: "linux",
  pin: "86dc686cf2fd795b2b24af3d614bb0e1307bcd76",
  fixture: FIXTURE,
  measuredAt: new Date().toISOString(),
  metric: hw.metric,
  hw: {
    available: hw.available,
    metric: hw.metric,
    sample: hw.sample ?? null,
    tried: hw.tried,
    probes: hw.probes,
    softProxy: Boolean(hw.softProxy),
  },
  notes: hw.notes,
  rows,
};
const outPath = path.join(RESULTS, outName);
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath);
