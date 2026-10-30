#!/usr/bin/env node
import { dirname, join } from "path";
import { fileURLToPath as __fu } from "url";
process.env.PATH = join(dirname(__fu(import.meta.url)), "..", "bin") + ":" + (process.env.PATH || "");
/**
 * Baseline / A/B measurement runner.
 * Primary: HW counters via `perf` when available → cpuEvents.
 * Fallback: cpuEvents=-1 + softCpuUs from process.cpuUsage (µs).
 *
 * Usage:
 *   node harness/measure.mjs official|fast [out.json] [--suite small|large|all]
 */
import { performance } from "perf_hooks";
import { writeFile, mkdir, copyFile, access } from "fs/promises";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(HARNESS_ROOT, "fixture");
const RESULTS = path.join(HARNESS_ROOT, "results");

const argv = process.argv.slice(2);
const mode = argv.find((a) => a === "official" || a === "fast") || "official";
const suiteArgIdx = argv.indexOf("--suite");
const suite = suiteArgIdx >= 0 ? argv[suiteArgIdx + 1] || "small" : "small";
const outName =
  argv.find((a, i) => a !== "official" && a !== "fast" && a !== "--suite" && argv[i - 1] !== "--suite") ||
  `baseline-${mode}.json`;

const toolsMod =
  mode === "fast"
    ? await import("../packages/fast-tools/src/tools.mjs")
    : await import("../packages/official-shim/src/tools.mjs");

import { readFileSync, readdirSync } from "fs";
function probeHwCountersEsm() {
  const probes = [];
  const which = spawnSync("sh", ["-c", "command -v perf"], { encoding: "utf8" });
  const perfPath = (which.stdout || "").trim();
  probes.push({
    cmd: "command -v perf",
    ok: Boolean(perfPath),
    detail: perfPath || "perf not on PATH",
  });
  let paranoid = null;
  try {
    paranoid = readFileSync("/proc/sys/kernel/perf_event_paranoid", "utf8").trim();
    probes.push({ cmd: "cat /proc/sys/kernel/perf_event_paranoid", ok: true, detail: paranoid });
  } catch (e) {
    probes.push({ cmd: "cat /proc/sys/kernel/perf_event_paranoid", ok: false, detail: String(e.message || e) });
  }
  let sample = null;
  if (perfPath) {
    const r = spawnSync(perfPath, ["stat", "-e", "instructions:u", "-x", ",", "--", "true"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
    probes.push({
      cmd: "perf stat -e instructions:u -x, -- true",
      ok: r.status === 0,
      detail: combined.trim().slice(0, 300),
    });
    if (r.status === 0) {
      const line = (r.stderr || r.stdout || "").split("\n").find((l) => /instructions/.test(l));
      if (line) {
        const val = Number(String(line.split(",")[0]).replace(/,/g, ""));
        if (Number.isFinite(val)) sample = val;
      }
    }
  } else {
    probes.push({
      cmd: "perf stat -e instructions:u -x, -- true",
      ok: false,
      detail: "skipped (no perf binary)",
    });
  }
  try {
    const devs = readdirSync("/sys/bus/event_source/devices");
    const hasCpu = devs.some((d) => d === "cpu" || d.startsWith("cpu"));
    probes.push({
      cmd: "ls /sys/bus/event_source/devices",
      ok: true,
      detail: `${devs.join(",")} (cpuPmu=${hasCpu})`,
    });
  } catch (e) {
    probes.push({ cmd: "ls /sys/bus/event_source/devices", ok: false, detail: String(e.message || e) });
  }
  const available = sample != null;
  return {
    available,
    sampleInstructions: sample,
    probes,
    notes: available
      ? "HW counters available via perf; per-op sampling not wired (use softCpuUs); set cpuEvents when per-op path lands"
      : `cpuEvents=-1; HW counters unavailable on this box. Probe commands: ${probes.map((p) => p.cmd).join(" | ")}. Failures: ${probes
          .filter((p) => !p.ok)
          .map((p) => `${p.cmd}: ${p.detail}`)
          .join("; ") || "perf missing; no instructions:u sample"}. softCpuUs=process.cpuUsage user+system µs avg over rounds`,
  };
}

async function readPeakRssKb() {
  try {
    const st = readFileSync("/proc/self/status", "utf8");
    const m = st.match(/VmHWM:\s+(\d+)/);
    if (m) return Number(m[1]);
  } catch {}
  return Math.round(process.memoryUsage().rss / 1024);
}

async function measureOne(name, fn, hw, rounds = 15) {
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
  const wallMs = walls[Math.floor(walls.length / 2)];
  return {
    tool: name,
    cpuEvents: -1,
    softCpuUs: Math.round(softCpuUs / rounds),
    wallMs: Math.round(wallMs * 1000) / 1000,
    peakRssKb: await readPeakRssKb(),
    binaryBytes: -1,
    env: `${os.type()} ${os.release()} ${os.arch()} node${process.version} rounds=${rounds}`,
    notes: hw.notes,
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
const hw = probeHwCountersEsm();
console.error("HW probe:", JSON.stringify({ available: hw.available, probes: hw.probes }, null, 2));

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
    const row = await measureOne(name, fn, hw);
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
  suite,
  platform: "linux",
  pin: "86dc686cf2fd795b2b24af3d614bb0e1307bcd76",
  fixture: FIXTURE,
  measuredAt: new Date().toISOString(),
  hw: { available: hw.available, probes: hw.probes },
  rows,
};
const outPath = path.join(RESULTS, outName);
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath);
