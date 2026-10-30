/**
 * Deterministic / event-count metric probe + collectors.
 *
 * Preference order (first that works wins):
 *   1) perf / pe_count HW instructions (instructions:u)
 *   2) Valgrind cachegrind Ir (+ node --predictable)
 *   3) Other non-wall event counts (pe_count page_faults) — weaker
 *   4) softCpuUs reproducible proxy (process.cpuUsage) with stability stats
 */
import { spawnSync } from "child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "../..");
const PE_COUNT = path.join(HARNESS_ROOT, "bin", "pe_count");

export function resolveNodeBin() {
  const candidates = [
    process.env.HARNESS_NODE_BIN,
    "/usr/local/lib/nodejs/node",
    process.execPath,
  ].filter(Boolean);
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const buf = readFileSync(c);
      // skip shell wrappers — valgrind needs the ELF
      if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21) continue; // #!
      return c;
    } catch {
      return c;
    }
  }
  return process.execPath;
}

function which(cmd) {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return (r.stdout || "").trim() || null;
}

function probePerfInstructions(probes) {
  const pe = existsSync(PE_COUNT) ? PE_COUNT : null;
  probes.push({
    cmd: "bin/pe_count present",
    ok: Boolean(pe),
    detail: pe || "missing",
  });
  let paranoid = null;
  try {
    paranoid = readFileSync("/proc/sys/kernel/perf_event_paranoid", "utf8").trim();
    probes.push({ cmd: "cat /proc/sys/kernel/perf_event_paranoid", ok: true, detail: paranoid });
  } catch (e) {
    probes.push({ cmd: "cat /proc/sys/kernel/perf_event_paranoid", ok: false, detail: String(e.message || e) });
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
  const perfPath = which("perf");
  probes.push({ cmd: "command -v perf", ok: Boolean(perfPath), detail: perfPath || "perf not on PATH" });
  if (perfPath) {
    const r = spawnSync(perfPath, ["stat", "-e", "instructions:u", "-x", ",", "--", "true"], {
      encoding: "utf8",
      timeout: 8000,
    });
    const combined = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
    probes.push({
      cmd: "perf stat -e instructions:u -x, -- true",
      ok: r.status === 0 && !/error while loading|Permission|not supported/i.test(combined),
      detail: combined.slice(0, 300),
    });
    if (r.status === 0) {
      const line = combined.split("\n").find((l) => /instructions/.test(l));
      if (line) {
        const val = Number(String(line.split(",")[0]).replace(/,/g, ""));
        if (Number.isFinite(val) && val > 0) {
          return { metric: "perf-instructions", sample: val, available: true };
        }
      }
    }
  } else {
    probes.push({ cmd: "perf stat -e instructions:u -x, -- true", ok: false, detail: "skipped (no perf binary)" });
  }
  if (pe) {
    const r = spawnSync(pe, ["hw_instructions", "--", "true"], { encoding: "utf8", timeout: 5000 });
    const detail = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
    const m = detail.match(/pe_count,hw_instructions,(\d+)/);
    const ok = r.status === 0 && m;
    probes.push({ cmd: "pe_count hw_instructions -- true", ok: Boolean(ok), detail: detail.slice(0, 300) });
    if (ok) return { metric: "perf-instructions", sample: Number(m[1]), available: true };
  }
  return null;
}

function probeValgrindIr(probes) {
  const vg = which("valgrind");
  probes.push({ cmd: "command -v valgrind", ok: Boolean(vg), detail: vg || "valgrind not on PATH" });
  if (!vg) return null;
  const nodeBin = resolveNodeBin();
  probes.push({ cmd: "resolveNodeBin", ok: true, detail: nodeBin });
  const r = spawnSync(
    vg,
    [
      "--tool=cachegrind",
      "--cache-sim=no",
      "--branch-sim=no",
      "--trace-children=yes",
      "--cachegrind-out-file=/dev/null",
      nodeBin,
      "--predictable",
      "-e",
      "let s=0;for(let i=0;i<1000;i++)s+=i;",
    ],
    { encoding: "utf8", timeout: 120000 },
  );
  const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
  const ir = parseIr(combined);
  probes.push({
    cmd: "valgrind --tool=cachegrind node --predictable -e <loop>",
    ok: ir != null,
    detail: ir != null ? `I refs=${ir}` : combined.trim().slice(0, 400),
  });
  if (ir != null) return { metric: "valgrind-ir", sample: ir, available: true, nodeBin, valgrind: vg };
  return null;
}

function probeOtherEvents(probes) {
  const pe = existsSync(PE_COUNT) ? PE_COUNT : null;
  if (!pe) {
    probes.push({ cmd: "pe_count page_faults", ok: false, detail: "bin/pe_count missing" });
    return null;
  }
  const r = spawnSync(pe, ["page_faults", "--", "true"], { encoding: "utf8", timeout: 5000 });
  const detail = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  const m = detail.match(/pe_count,page_faults,(\d+)/);
  probes.push({ cmd: "pe_count page_faults -- true", ok: Boolean(m), detail: detail.slice(0, 200) });
  if (m) {
    return {
      metric: "page-faults",
      sample: Number(m[1]),
      available: true,
      note: "weaker non-instruction event; prefer valgrind-ir when present",
    };
  }
  return null;
}

export function parseIr(text) {
  const m = String(text).match(/I\s+refs:\s*([0-9,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function stabilityStats(samples) {
  const a = samples.filter((x) => Number.isFinite(x) && x >= 0).slice().sort((x, y) => x - y);
  if (!a.length) return { n: 0, median: -1, min: -1, max: -1, cv: null };
  const median = a[Math.floor(a.length / 2)];
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const variance = a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length;
  const sd = Math.sqrt(variance);
  const cv = mean > 0 ? sd / mean : null;
  return { n: a.length, median, min: a[0], max: a[a.length - 1], mean, cv };
}

/**
 * Probe once. Returns metric descriptor used for the rest of the run.
 */
export function probeDeterministicMetric() {
  const probes = [];
  const tried = [];

  const hw = probePerfInstructions(probes);
  tried.push({ step: 1, name: "perf-instructions", ok: Boolean(hw) });
  if (hw) {
    return {
      ...hw,
      probes,
      tried,
      notes: `metric=${hw.metric}; sample=${hw.sample}; lab primary = HW instruction events via perf/pe_count`,
    };
  }

  const ir = probeValgrindIr(probes);
  tried.push({ step: 2, name: "valgrind-ir", ok: Boolean(ir) });
  if (ir) {
    return {
      ...ir,
      probes,
      tried,
      notes: `metric=${ir.metric}; sampleIr=${ir.sample}; lab primary = Valgrind cachegrind Ir with node --predictable; wallMs secondary (not lab gate)`,
    };
  }

  const other = probeOtherEvents(probes);
  tried.push({ step: 3, name: "page-faults", ok: Boolean(other) });
  if (other) {
    return {
      ...other,
      probes,
      tried,
      notes: `metric=${other.metric}; sample=${other.sample}; fallback non-wall event (not instructions)`,
    };
  }

  tried.push({ step: 4, name: "soft-cpu-proxy", ok: true });
  return {
    metric: "soft-cpu-proxy",
    available: true, // soft proxy always available; still produces a ratchetable count
    sample: null,
    probes,
    tried,
    softProxy: true,
    notes:
      "metric=soft-cpu-proxy; hard counters unavailable after trying perf-instructions → valgrind-ir → page-faults; softCpuUs=process.cpuUsage user+system µs (report stability N); wallMs secondary (not lab gate)",
  };
}

/**
 * Run a worker under Valgrind cachegrind; return Ir (median of repeats).
 */
export function measureValgrindIr({ workerPath, workerArgs = [], repeats = 1, timeoutMs = 300000 }) {
  const vg = which("valgrind");
  if (!vg) throw new Error("valgrind missing");
  const nodeBin = resolveNodeBin();
  const samples = [];
  for (let i = 0; i < repeats; i++) {
    const tmp = mkdtempSync(path.join(osTmp(), "harness-cg-"));
    try {
      const outPat = path.join(tmp, "cg-%p.out");
      const r = spawnSync(
        vg,
        [
          "--tool=cachegrind",
          "--cache-sim=no",
          "--branch-sim=no",
          "--trace-children=yes",
          `--cachegrind-out-file=${outPat}`,
          nodeBin,
          "--predictable",
          workerPath,
          ...workerArgs,
        ],
        {
          encoding: "utf8",
          timeout: timeoutMs,
          cwd: HARNESS_ROOT,
          env: { ...process.env, PATH: `${path.join(HARNESS_ROOT, "bin")}:${process.env.PATH || ""}` },
        },
      );
      const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
      let ir = sumCachegrindSummaries(tmp);
      if (ir == null) ir = parseIr(combined);
      if (ir == null) {
        throw new Error(`valgrind Ir parse failed (status=${r.status}): ${combined.slice(0, 500)}`);
      }
      samples.push(ir);
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  }
  const st = stabilityStats(samples);
  return { ir: st.median, samples, stability: st };
}

function osTmp() {
  return process.env.TMPDIR || "/tmp";
}

export function sumCachegrindSummaries(dir) {
  let sum = 0;
  let n = 0;
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.startsWith("cg-") || !f.endsWith(".out")) continue;
    try {
      const text = readFileSync(path.join(dir, f), "utf8");
      const m = text.match(/^summary:\s*([0-9]+)/m);
      if (m) {
        sum += Number(m[1]);
        n++;
      }
    } catch {}
  }
  return n ? sum : null;
}


export async function measureSoftCpuProxy(fn, rounds = 15) {
  await fn();
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const cpu0 = process.cpuUsage();
    await fn();
    const cpu1 = process.cpuUsage(cpu0);
    samples.push(cpu1.user + cpu1.system);
  }
  const st = stabilityStats(samples);
  return { count: Math.round(st.median), samples, stability: st };
}
