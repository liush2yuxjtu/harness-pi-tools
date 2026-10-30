#!/usr/bin/env node
/**
 * Fair in-process A/B: alternate official/fast per scenario (same process, same JIT).
 * Usage: node harness/bench-ab.mjs [--suite small|large|all] [--rounds 31] [--out results/bench-linux.json]
 */
import { dirname, join } from "path";
import { fileURLToPath as __fu } from "url";
process.env.PATH = join(dirname(__fu(import.meta.url)), "..", "bin") + ":" + (process.env.PATH || "");

import { performance } from "perf_hooks";
import { writeFile, mkdir, copyFile, access } from "fs/promises";
import { readFileSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import * as Official from "../packages/official-shim/src/tools.mjs";
import * as Fast from "../packages/fast-tools/src/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "fixture");
const RESULTS = path.join(ROOT, "results");

const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}
const suite = flag("suite", "small");
const rounds = Number(flag("rounds", "31"));
const outName = flag("out", suite === "large" ? "bench-linux-large.json" : "bench-linux.json");

function probeHw() {
  const probes = [];
  const which = spawnSync("sh", ["-c", "command -v perf"], { encoding: "utf8" });
  const perfPath = (which.stdout || "").trim();
  probes.push({ cmd: "command -v perf", ok: Boolean(perfPath), detail: perfPath || "perf not on PATH" });
  try {
    probes.push({
      cmd: "cat /proc/sys/kernel/perf_event_paranoid",
      ok: true,
      detail: readFileSync("/proc/sys/kernel/perf_event_paranoid", "utf8").trim(),
    });
  } catch (e) {
    probes.push({ cmd: "cat /proc/sys/kernel/perf_event_paranoid", ok: false, detail: String(e.message || e) });
  }
  if (perfPath) {
    const r = spawnSync(perfPath, ["stat", "-e", "instructions:u", "-x", ",", "--", "true"], {
      encoding: "utf8",
      timeout: 5000,
    });
    probes.push({
      cmd: "perf stat -e instructions:u -x, -- true",
      ok: r.status === 0,
      detail: `${r.stdout || ""}\n${r.stderr || ""}`.trim().slice(0, 300),
    });
  } else {
    probes.push({ cmd: "perf stat -e instructions:u -x, -- true", ok: false, detail: "skipped (no perf binary)" });
  }
  try {
    const devs = readdirSync("/sys/bus/event_source/devices");
    probes.push({
      cmd: "ls /sys/bus/event_source/devices",
      ok: true,
      detail: `${devs.join(",")} (cpuPmu=${devs.some((d) => d === "cpu" || d.startsWith("cpu"))})`,
    });
  } catch (e) {
    probes.push({ cmd: "ls /sys/bus/event_source/devices", ok: false, detail: String(e.message || e) });
  }
  const available = false; // no per-op sampling yet even if perf exists
  const notes = `cpuEvents=-1; HW counters unavailable on this box. Probe commands: ${probes
    .map((p) => p.cmd)
    .join(" | ")}. Failures: ${probes
    .filter((p) => !p.ok)
    .map((p) => `${p.cmd}: ${p.detail}`)
    .join("; ") || "none"}. softCpuUs=process.cpuUsage user+system µs; wallMs=median of ${rounds} paired rounds after warmups; fair in-process A/B`;
  return { available, probes, notes };
}

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

async function pairedMeasure(name, offFn, fastFn, hwNotes) {
  // warmups
  for (let i = 0; i < 5; i++) {
    await offFn();
    await fastFn();
  }
  const offWalls = [],
    fastWalls = [];
  let offSoft = 0,
    fastSoft = 0;
  for (let i = 0; i < rounds; i++) {
    let cpu0 = process.cpuUsage();
    let t0 = performance.now();
    await offFn();
    offWalls.push(performance.now() - t0);
    let c1 = process.cpuUsage(cpu0);
    offSoft += c1.user + c1.system;

    cpu0 = process.cpuUsage();
    t0 = performance.now();
    await fastFn();
    fastWalls.push(performance.now() - t0);
    c1 = process.cpuUsage(cpu0);
    fastSoft += c1.user + c1.system;
  }
  return {
    tool: name,
    officialCpu: -1,
    fastCpu: -1,
    officialSoftCpuUs: Math.round(offSoft / rounds),
    fastSoftCpuUs: Math.round(fastSoft / rounds),
    officialWallMs: Math.round(median(offWalls) * 1000) / 1000,
    fastWallMs: Math.round(median(fastWalls) * 1000) / 1000,
    officialRssKb: -1,
    fastRssKb: -1,
    binaryBytes: -1,
  };
}

await mkdir(RESULTS, { recursive: true });
if (suite === "large" || suite === "all") await ensureLarge();

const hw = probeHw();
console.error("HW", JSON.stringify({ available: hw.available, probes: hw.probes }, null, 2));

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
  const row = await pairedMeasure(name, o, f, hw.notes);
  rows.push(row);
  console.log(
    JSON.stringify({
      tool: name,
      officialWallMs: row.officialWallMs,
      fastWallMs: row.fastWallMs,
      ratio: Math.round((row.officialWallMs / row.fastWallMs) * 100) / 100,
      gate5: row.fastWallMs <= row.officialWallMs * 1.05,
    }),
  );
}

const out = {
  platform: "linux",
  pin: "86dc686cf2fd795b2b24af3d614bb0e1307bcd76",
  suite,
  measuredAt: new Date().toISOString(),
  env: `${os.type()} ${os.release()} ${os.arch()} node${process.version} rounds=${rounds} paired=in-process`,
  notes: hw.notes,
  hw: { available: hw.available, probes: hw.probes },
  rows,
};
const outPath = path.join(RESULTS, outName);
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath);
