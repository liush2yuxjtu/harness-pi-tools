#!/usr/bin/env node
/**
 * Out-of-process worker for Valgrind Ir (or pe_count) measurement.
 * Usage: node --predictable harness/ir-worker.mjs <official|fast> <scenario> [rounds]
 */
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFile, copyFile, access, mkdir } from "fs/promises";
import { spawnSync } from "child_process";
import path from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
process.env.PATH = join(ROOT, "bin") + ":" + (process.env.PATH || "");
const FIXTURE = join(ROOT, "fixture");

const mode = process.argv[2];
const scenario = process.argv[3];
const rounds = Number(process.argv[4] || process.env.HARNESS_IR_ROUNDS || 30);
if (mode !== "official" && mode !== "fast") {
  console.error("usage: ir-worker.mjs official|fast <scenario> [rounds]");
  process.exit(2);
}

const tools =
  mode === "fast"
    ? await import("../packages/fast-tools/src/tools.mjs")
    : await import("../packages/official-shim/src/tools.mjs");

async function ensureLarge() {
  try {
    await access(join(FIXTURE, "large", "dir_2k", ".generated"));
  } catch {
    const r = spawnSync(process.execPath, [join(FIXTURE, "generate-large.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("generate-large failed");
  }
}

const editRel = `edit_sandbox/target_ir_${mode}.txt`;
await mkdir(join(FIXTURE, "edit_sandbox"), { recursive: true });
await mkdir(join(FIXTURE, "write_sandbox"), { recursive: true });
await copyFile(join(FIXTURE, "edit_sandbox/target.txt"), join(FIXTURE, editRel)).catch(async () => {
  await writeFile(join(FIXTURE, editRel), "alpha\nbeta\ngamma\n");
});

const small = {
  "read:small": () => tools.toolRead(FIXTURE, { filePath: "src/js/hello.js" }),
  "read:boundary-lines": () => tools.toolRead(FIXTURE, { filePath: "boundary/lines_2500.txt" }),
  bash: () => tools.toolBash(FIXTURE, { command: "seq 1 3000" }),
  edit: async () => {
    await writeFile(join(FIXTURE, editRel), "alpha\nbeta\ngamma\n");
    return tools.toolEdit(FIXTURE, {
      filePath: editRel,
      edits: [{ oldText: "beta", newText: "BETA" }],
    });
  },
  write: () =>
    tools.toolWrite(FIXTURE, {
      filePath: `write_sandbox/out_ir_${mode}.txt`,
      content: "hello harness\n".repeat(100),
    }),
  grep: () => tools.toolGrep(FIXTURE, { pattern: "ALPHA", path: "src/js" }),
  find: () => tools.toolFind(FIXTURE, { pattern: "*.js", path: "src" }),
  ls: () => tools.toolLs(FIXTURE, { dirPath: "src/js" }),
};

const large = {
  "read:large-2mb": () => tools.toolRead(FIXTURE, { filePath: "large/big_2_5mb.txt" }),
  "read:near-2000": () => tools.toolRead(FIXTURE, { filePath: "large/near_2000_lines.txt" }),
  "read:near-50kb": () => tools.toolRead(FIXTURE, { filePath: "large/near_50kb.txt" }),
  "ls:dir-2k": () => tools.toolLs(FIXTURE, { dirPath: "large/dir_2k" }),
  "find:dir-2k": () => tools.toolFind(FIXTURE, { pattern: "*.txt", path: "large/dir_2k" }),
  "grep:large-2mb": () => tools.toolGrep(FIXTURE, { pattern: "ALPHA", path: "large/big_2_5mb.txt" }),
};

const all = { ...small, ...large };
const fn = all[scenario];
if (!fn) {
  console.error("unknown scenario", scenario);
  process.exit(2);
}
if (scenario in large) await ensureLarge();

// one warmup + N timed rounds (all counted under Valgrind)
await fn();
for (let i = 0; i < rounds; i++) await fn();
console.log(JSON.stringify({ ok: true, mode, scenario, rounds }));
