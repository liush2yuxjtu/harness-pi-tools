/**
 * Long-lived harness-helper client (JSONL serve protocol).
 * Falls back to null when binary missing — callers keep JS path.
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HELPER = path.join(ROOT, "bin", "harness-helper");

let child = null;
let buf = "";
let pending = [];
let starting = null;
let hooked = false;

function enabled() {
  if (process.env.HARNESS_NATIVE === "0") return false;
  return existsSync(HELPER);
}

function hookExit() {
  if (hooked) return;
  hooked = true;
  const shutdown = () => {
    try {
      if (child && !child.killed) {
        try { child.stdin.end(); } catch {}
        child.kill("SIGTERM");
      }
    } catch {}
    child = null;
  };
  process.on("exit", shutdown);
  process.on("beforeExit", shutdown);
  process.on("SIGINT", () => { shutdown(); process.exit(130); });
  process.on("SIGTERM", () => { shutdown(); process.exit(143); });
}

function ensure() {
  if (child && !child.killed) return Promise.resolve(true);
  if (starting) return starting;
  if (!enabled()) return Promise.resolve(false);
  hookExit();
  starting = new Promise((resolve, reject) => {
    child = spawn(HELPER, ["serve"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: `${path.join(ROOT, "bin")}:${process.env.PATH || ""}` },
    });
    buf = "";
    pending = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const waiter = pending.shift();
        if (!waiter) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ok) waiter.resolve(msg.text);
          else waiter.reject(new Error(msg.error || "native helper error"));
        } catch (e) {
          waiter.reject(e);
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", (e) => {
      for (const w of pending) w.reject(e);
      pending = [];
      child = null;
      starting = null;
      reject(e);
    });
    child.on("exit", () => {
      const err = new Error("native helper exited");
      for (const w of pending) w.reject(err);
      pending = [];
      child = null;
      starting = null;
    });
    pending.push({
      resolve: () => {
        starting = null;
        resolve(true);
      },
      reject: (e) => {
        starting = null;
        reject(e);
      },
    });
    child.stdin.write('{"op":"ping"}\n');
  });
  return starting;
}

export async function nativeCall(op, fields) {
  const ok = await ensure();
  if (!ok) return null;
  const payload = JSON.stringify({ op, ...fields });
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
    try {
      child.stdin.write(payload + "\n");
    } catch (e) {
      pending.pop();
      reject(e);
    }
  });
}

export function nativeAvailable() {
  return enabled();
}

export function nativeShutdown() {
  try {
    if (child && !child.killed) {
      try { child.stdin.end(); } catch {}
      child.kill("SIGTERM");
    }
  } catch {}
  child = null;
}
