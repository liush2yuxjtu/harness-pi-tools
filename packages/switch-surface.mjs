/**
 * switchSurface — select official-shim vs fast-tools by HARNESS_TOOLS.
 * Accepts official coding-agent param names (`path`) and maps to harness (`filePath`/`dirPath`).
 *
 * Embed sketch (do not mutate earendil-pi):
 *   import { createToolFns } from '.../packages/switch-surface.mjs'
 *   const tools = createToolFns(cwd)
 *   await tools.read({ path: 'foo.ts' })
 */
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function resolveMode(env = process.env) {
  const v = (env.HARNESS_TOOLS || "official").toLowerCase();
  if (v !== "official" && v !== "fast") {
    throw new Error(`HARNESS_TOOLS must be official|fast, got ${v}`);
  }
  return v;
}

export async function loadToolsModule(mode = resolveMode()) {
  if (mode === "fast") return import(path.join(HERE, "fast-tools/src/tools.mjs"));
  return import(path.join(HERE, "official-shim/src/tools.mjs"));
}

/** Map official schema field names → harness internal names. */
export function mapReadArgs({ path: p, filePath, offset, limit }) {
  return { filePath: filePath || p, offset, limit };
}
export function mapLsArgs({ path: p, dirPath, limit }) {
  return { dirPath: dirPath || p || ".", limit };
}
export function mapWriteArgs({ path: p, filePath, content }) {
  return { filePath: filePath || p, content };
}
export function mapEditArgs({ path: p, filePath, edits }) {
  return { filePath: filePath || p, edits };
}
export function mapGrepArgs({ pattern, path: searchPath, glob }) {
  return { pattern, path: searchPath, glob };
}
export function mapFindArgs({ pattern, path: searchPath }) {
  return { pattern, path: searchPath };
}

/**
 * Same tool names as pin coding-agent: read|bash|edit|write|grep|find|ls.
 * Parameter objects accept official `path` (and harness aliases).
 */
export async function createToolFns(cwd, { mode } = {}) {
  const m = mode || resolveMode();
  const mod = await loadToolsModule(m);
  return {
    mode: m,
    read: (args) => mod.toolRead(cwd, mapReadArgs(args)),
    bash: (args) => mod.toolBash(cwd, args),
    edit: (args) => mod.toolEdit(cwd, mapEditArgs(args)),
    write: (args) => mod.toolWrite(cwd, mapWriteArgs(args)),
    grep: (args) => mod.toolGrep(cwd, mapGrepArgs(args)),
    find: (args) => mod.toolFind(cwd, mapFindArgs(args)),
    ls: (args) => mod.toolLs(cwd, mapLsArgs(args)),
  };
}

export const OFFICIAL_SCHEMA_NOTES = {
  read: "{ path, offset?, limit? }",
  bash: "{ command }",
  edit: "{ path, edits: [{ oldText, newText }] }",
  write: "{ path, content }",
  grep: "{ pattern, path?, glob? }",
  find: "{ pattern, path? }",
  ls: "{ path?, limit? }",
  alignment:
    "Names + shapes match earendil-pi coding-agent pin 86dc686 TypeBox schemas (path not filePath). Harness internal APIs still use filePath/dirPath; switch-surface maps at the boundary.",
};
