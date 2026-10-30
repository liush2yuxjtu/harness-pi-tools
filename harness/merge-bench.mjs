#!/usr/bin/env node
/** Merge official+fast baselines into bench-linux.json (or custom out). */
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const officialPath = process.argv[2] || path.join(ROOT, "results", "baseline-official.json");
const fastPath = process.argv[3] || path.join(ROOT, "results", "baseline-fast.json");
const outPath = process.argv[4] || path.join(ROOT, "results", "bench-linux.json");

const official = JSON.parse(await readFile(officialPath, "utf8"));
const fast = JSON.parse(await readFile(fastPath, "utf8"));

const byTool = new Map(fast.rows.map((r) => [r.tool, r]));
const rows = [];
for (const o of official.rows) {
  const f = byTool.get(o.tool);
  if (!f) continue;
  rows.push({
    tool: o.tool,
    officialCpu: o.cpuEvents ?? -1,
    fastCpu: f.cpuEvents ?? -1,
    officialSoftCpuUs: o.softCpuUs ?? -1,
    fastSoftCpuUs: f.softCpuUs ?? -1,
    officialWallMs: o.wallMs,
    fastWallMs: f.wallMs,
    officialRssKb: o.peakRssKb,
    fastRssKb: f.peakRssKb,
    binaryBytes: -1,
  });
}

const notes = [
  official.rows[0]?.notes || "",
  `suite=${official.suite || "small"}`,
  `hw.available=${official.hw?.available ?? false}`,
].join("; ");

const out = {
  platform: "linux",
  pin: official.pin,
  suite: official.suite || "small",
  measuredAt: new Date().toISOString(),
  env: official.rows[0]?.env || "",
  notes,
  hw: official.hw || null,
  rows,
};
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath, "rows", rows.length);
