#!/usr/bin/env node
import { dirname, join } from "path";
import { fileURLToPath as __fu } from "url";
process.env.PATH = join(dirname(__fu(import.meta.url)), "..", "bin") + ":" + (process.env.PATH || "");
import { writeFile, mkdir, copyFile, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as Official from "../packages/official-shim/src/tools.mjs";
import * as Fast from "../packages/fast-tools/src/tools.mjs";
import * as OT from "../packages/official-shim/src/truncate.mjs";
import * as FT from "../packages/fast-tools/src/truncate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(HARNESS_ROOT, "fixture");
const RESULTS = path.join(HARNESS_ROOT, "results");
await mkdir(RESULTS, { recursive: true });

const failures = [];

function assertEq(label, a, b) {
  if (a !== b) failures.push(`${label}: mismatch\n  official=${JSON.stringify(a).slice(0, 200)}\n  fast=${JSON.stringify(b).slice(0, 200)}`);
}

// Truncate unit cases
for (const s of [
  "",
  "a",
  "a\n",
  "a\nb\nc\n",
  Array.from({ length: 2500 }, (_, i) => `L${i}`).join("\n"),
  ("X".repeat(79) + "\n").repeat(800),
  "Y".repeat(51 * 1024) + "\nsecond\n",
]) {
  for (const fn of ["truncateHead", "truncateTail"]) {
    const o = OT[fn](s);
    const f = FT[fn](s);
    assertEq(`truncate.${fn}.content`, o.content, f.content);
    assertEq(`truncate.${fn}.truncatedBy`, o.truncatedBy, f.truncatedBy);
    assertEq(`truncate.${fn}.firstLineExceedsLimit`, o.firstLineExceedsLimit, f.firstLineExceedsLimit);
    assertEq(`truncate.${fn}.outputLines`, o.outputLines, f.outputLines);
  }
}

// Tool scenarios
const editOff = "edit_sandbox/parity_official.txt";
const editFast = "edit_sandbox/parity_fast.txt";
await writeFile(path.join(FIXTURE, editOff), "alpha\nbeta\ngamma\n");
await writeFile(path.join(FIXTURE, editFast), "alpha\nbeta\ngamma\n");

const cases = [
  ["read", () => Official.toolRead(FIXTURE, { filePath: "boundary/lines_2500.txt" }), () => Fast.toolRead(FIXTURE, { filePath: "boundary/lines_2500.txt" })],
  ["read-huge-first", () => Official.toolRead(FIXTURE, { filePath: "boundary/huge_first_line.txt" }), () => Fast.toolRead(FIXTURE, { filePath: "boundary/huge_first_line.txt" })],
  ["bash", () => Official.toolBash(FIXTURE, { command: "seq 1 3000" }), () => Fast.toolBash(FIXTURE, { command: "seq 1 3000" })],
  ["ls", () => Official.toolLs(FIXTURE, { dirPath: "src/js" }), () => Fast.toolLs(FIXTURE, { dirPath: "src/js" })],
  ["grep", () => Official.toolGrep(FIXTURE, { pattern: "ALPHA", path: "src/js" }), () => Fast.toolGrep(FIXTURE, { pattern: "ALPHA", path: "src/js" })],
  ["find", () => Official.toolFind(FIXTURE, { pattern: "*.js", path: "src" }), () => Fast.toolFind(FIXTURE, { pattern: "*.js", path: "src" })],
  ["write", () => Official.toolWrite(FIXTURE, { filePath: "write_sandbox/parity_o.txt", content: "x\n" }), () => Fast.toolWrite(FIXTURE, { filePath: "write_sandbox/parity_f.txt", content: "x\n" })],
  ["edit", () => Official.toolEdit(FIXTURE, { filePath: editOff, edits: [{ oldText: "beta", newText: "BETA" }] }), () => Fast.toolEdit(FIXTURE, { filePath: editFast, edits: [{ oldText: "beta", newText: "BETA" }] })],
];

for (const [name, oFn, fFn] of cases) {
  try {
    const o = await oFn();
    const f = await fFn();
    if (name === "write") {
      // message includes path; compare suffix pattern
      assertEq("write.ok", o.text.startsWith("Successfully wrote to "), true);
      assertEq("write.fast.ok", f.text.startsWith("Successfully wrote to "), true);
    } else if (name === "edit") {
      assertEq("edit.ok", o.text.startsWith("Successfully edited "), true);
      assertEq("edit.fast.ok", f.text.startsWith("Successfully edited "), true);
      const oBody = await readFile(path.join(FIXTURE, editOff), "utf8");
      const fBody = await readFile(path.join(FIXTURE, editFast), "utf8");
      assertEq("edit.body", oBody, fBody);
    } else {
      assertEq(`${name}.text`, o.text, f.text);
    }
  } catch (e) {
    failures.push(`${name}: threw ${e && e.stack ? e.stack : e}`);
  }
}

const passed = failures.length === 0;
const report = { passed, failures, at: new Date().toISOString() };
await writeFile(path.join(RESULTS, "parity.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(passed ? 0 : 1);
