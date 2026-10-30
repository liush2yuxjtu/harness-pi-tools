#!/usr/bin/env node
/**
 * Standalone A/B demo CLI — same schema as official coding-agent tools.
 *
 * Five steps (copy/paste):
 *   1) cd /workspace/harness-pi-tools
 *   2) export HARNESS_TOOLS=official   # or fast
 *   3) node scripts/ab-demo.mjs ls --path src/js
 *   4) HARNESS_TOOLS=fast node scripts/ab-demo.mjs ls --path src/js
 *   5) node scripts/ab-demo.mjs read --path boundary/lines_2500.txt
 *
 * Compare wall times:
 *   node scripts/ab-demo.mjs --bench ls --path src/js
 */
import path from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";
import { createToolFns, OFFICIAL_SCHEMA_NOTES, resolveMode } from "../packages/switch-surface.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.env.HARNESS_CWD || path.join(ROOT, "fixture");

function usage() {
  console.log(`Usage: HARNESS_TOOLS=official|fast node scripts/ab-demo.mjs [--bench] <tool> [--path P] [--pattern X] [--command C] [--content S]
Tools: read|bash|edit|write|grep|find|ls
Schema: ${JSON.stringify(OFFICIAL_SCHEMA_NOTES, null, 2)}`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

const bench = args.includes("--bench");
const filtered = args.filter((a) => a !== "--bench");
const tool = filtered[0];
function flag(name) {
  const i = filtered.indexOf(`--${name}`);
  return i >= 0 ? filtered[i + 1] : undefined;
}

const mode = resolveMode();
const tools = await createToolFns(cwd, { mode });

const input = {};
if (flag("path") !== undefined) input.path = flag("path");
if (flag("pattern") !== undefined) input.pattern = flag("pattern");
if (flag("command") !== undefined) input.command = flag("command");
if (flag("content") !== undefined) input.content = flag("content");
if (flag("glob") !== undefined) input.glob = flag("glob");
if (flag("limit") !== undefined) input.limit = Number(flag("limit"));
if (flag("offset") !== undefined) input.offset = Number(flag("offset"));

if (!tools[tool]) {
  console.error("unknown tool", tool);
  usage();
  process.exit(1);
}

async function once() {
  return tools[tool](input);
}

if (bench) {
  await once();
  const walls = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await once();
    walls.push(performance.now() - t0);
  }
  walls.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        mode,
        tool,
        input,
        cwd,
        wallMsMedian: Math.round(walls[2] * 1000) / 1000,
        walls,
      },
      null,
      2,
    ),
  );
} else {
  const t0 = performance.now();
  const result = await once();
  const wallMs = Math.round((performance.now() - t0) * 1000) / 1000;
  const text = result?.text ?? "";
  console.log(
    JSON.stringify(
      {
        mode,
        tool,
        input,
        cwd,
        wallMs,
        textPreview: text.slice(0, 400),
        textChars: text.length,
        truncated: result?.truncation?.truncated ?? null,
      },
      null,
      2,
    ),
  );
}
