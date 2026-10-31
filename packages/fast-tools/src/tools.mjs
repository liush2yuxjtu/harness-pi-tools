import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import {
  truncateHead,
  truncateHeadFromSplit,
  truncateTail,
  truncateLine,
  underLimitTruncation,
  countLinesNoAlloc,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "./truncate.mjs";
import { nativeCall, nativeAvailable } from "./native-client.mjs";

const DEFAULT_LS_LIMIT = 500;
const preferNative = () => process.env.HARNESS_NATIVE !== "0" && nativeAvailable();

function buildReadOutput({
  truncation,
  startLineDisplay,
  totalFileLines,
  allLines,
  startLine,
  userLimitedLines,
  filePath,
}) {
  let outputText;
  if (truncation.firstLineExceedsLimit) {
    outputText = `[Line ${startLineDisplay} is ${formatSize(Buffer.byteLength(allLines[startLine], "utf-8"))}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${filePath} | head -c ${DEFAULT_MAX_BYTES}]`;
  } else if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
    const nextOffset = endLineDisplay + 1;
    outputText = truncation.content;
    if (truncation.truncatedBy === "lines") {
      outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
    } else {
      outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
    }
  } else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
    const remaining = allLines.length - (startLine + userLimitedLines);
    const nextOffset = startLine + userLimitedLines + 1;
    outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  } else {
    outputText = truncation.content;
  }
  return { text: outputText, truncation };
}

export async function toolRead(cwd, { filePath, offset, limit }) {
  if (preferNative()) {
    try {
      const text = await nativeCall("read", {
        cwd,
        path: filePath,
        offset: offset ?? null,
        limit: limit ?? null,
      });
      if (text != null) return { text, truncation: null };
    } catch {
      /* fall through to JS */
    }
  }
  const absolutePath = path.resolve(cwd, filePath);
  const buffer = await readFile(absolutePath);
  const textContent = buffer.toString("utf-8");

  // Under-limit whole-file: skip split (Valgrind Ir / softCpu).
  if (limit === undefined && !offset) {
    const totalBytes = buffer.length;
    if (totalBytes <= DEFAULT_MAX_BYTES) {
      const totalLines = countLinesNoAlloc(textContent);
      if (totalLines <= DEFAULT_MAX_LINES) {
        return {
          text: textContent,
          truncation: underLimitTruncation(textContent, totalBytes, totalLines),
        };
      }
    }
  }

  const allLines = textContent.split("\n");
  const totalFileLines = allLines.length;
  const startLine = offset ? Math.max(0, offset - 1) : 0;
  const startLineDisplay = startLine + 1;
  if (startLine >= allLines.length) {
    throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
  }

  let selectedSplit;
  let userLimitedLines;
  if (limit !== undefined) {
    const endLine = Math.min(startLine + limit, allLines.length);
    selectedSplit = allLines.slice(startLine, endLine);
    userLimitedLines = endLine - startLine;
  } else {
    selectedSplit = allLines.slice(startLine);
  }

  let truncation;
  if (limit === undefined && startLine === 0) {
    const totalBytes = buffer.length;
    const countingLines = textContent.endsWith("\n") ? allLines.length - 1 : allLines.length;
    if (countingLines <= DEFAULT_MAX_LINES && totalBytes <= DEFAULT_MAX_BYTES) {
      truncation = underLimitTruncation(textContent, totalBytes, countingLines);
    } else {
      truncation = truncateHeadFromSplit(allLines, {
        totalBytes,
        underLimitContent: textContent,
      });
    }
  } else {
    truncation = truncateHeadFromSplit(selectedSplit);
  }

  return buildReadOutput({
    truncation,
    startLineDisplay,
    totalFileLines,
    allLines,
    startLine,
    userLimitedLines,
    filePath,
  });
}

export async function toolWrite(cwd, { filePath, content }) {
  if (preferNative()) {
    try {
      const text = await nativeCall("write", { cwd, path: filePath, content });
      if (text != null) return { text };
    } catch {
      /* JS fallback */
    }
  }
  const absolutePath = path.resolve(cwd, filePath);
  try {
    await writeFile(absolutePath, content, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf-8");
    } else {
      throw err;
    }
  }
  return { text: `Successfully wrote to ${filePath}` };
}

export async function toolEdit(cwd, { filePath, edits }) {
  if (preferNative() && edits.length === 1) {
    try {
      const { oldText, newText } = edits[0];
      const text = await nativeCall("edit", { cwd, path: filePath, oldText, newText });
      if (text != null) return { text };
    } catch {
      /* JS fallback */
    }
  }
  const absolutePath = path.resolve(cwd, filePath);
  let text = (await readFile(absolutePath)).toString("utf-8");
  for (const { oldText, newText } of edits) {
    const idx = text.indexOf(oldText);
    if (idx < 0) throw new Error(`oldText not found in ${filePath}`);
    if (text.lastIndexOf(oldText) !== idx) throw new Error(`oldText not unique in ${filePath}`);
    text = text.slice(0, idx) + newText + text.slice(idx + oldText.length);
  }
  await writeFile(absolutePath, text, "utf-8");
  return { text: `Successfully edited ${filePath}` };
}

export async function toolLs(cwd, { dirPath, limit } = {}) {
  if (preferNative()) {
    try {
      const text = await nativeCall("ls", {
        cwd,
        path: dirPath || ".",
        limit: limit ?? null,
      });
      if (text != null) return { text, truncation: null };
    } catch {
      /* JS fallback */
    }
  }
  const absolute = path.resolve(cwd, dirPath || ".");
  const st = await stat(absolute);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${absolute}`);
  const effectiveLimit = limit ?? DEFAULT_LS_LIMIT;
  const dirents = await readdir(absolute, { withFileTypes: true });
  dirents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const results = [];
  let entryLimitReached = false;
  for (const d of dirents) {
    if (results.length >= effectiveLimit) {
      entryLimitReached = true;
      break;
    }
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        const entryStat = await stat(path.join(absolute, d.name));
        isDir = entryStat.isDirectory();
      } catch {
        continue;
      }
    }
    results.push(d.name + (isDir ? "/" : ""));
  }
  if (results.length === 0) return { text: "(empty directory)" };
  const rawOutput = results.join("\n");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let output = truncation.content;
  const notices = [];
  if (entryLimitReached) notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
  if (truncation.truncated) notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  if (notices.length) output += `\n\n[${notices.join(". ")}]`;
  return { text: output, truncation };
}

function runSpawn(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], cwd });
    const chunks = [];
    const errChunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => errChunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(chunks).toString("utf-8"),
        stderr: Buffer.concat(errChunks).toString("utf-8"),
      });
    });
  });
}

export async function toolGrep(cwd, { pattern, path: searchPath = ".", glob }) {
  if (preferNative()) {
    try {
      const text = await nativeCall("grep", {
        cwd,
        pattern,
        path: searchPath,
        glob: glob ?? null,
      });
      if (text != null) return { text, truncation: null, matchCount: -1 };
    } catch {
      /* JS fallback */
    }
  }
  const args = ["--no-config", "--line-number", "--color", "never", "--sort", "path", pattern];
  if (glob) args.push("--glob", glob);
  args.push(searchPath);
  const { code, stdout, stderr } = await runSpawn("rg", args, { cwd });
  if (code !== 0 && code !== 1) throw new Error(stderr.trim() || `ripgrep exited ${code}`);
  const endsWithNl = stdout.endsWith("\n");
  const rawLines = stdout.split("\n");
  const n = endsWithNl ? rawLines.length - 1 : rawLines.length;
  const formatted = [];
  for (let i = 0; i < n; i++) {
    let line = rawLines[i];
    if (line.indexOf("\0") >= 0) line = line.replace(/\0/g, "");
    formatted.push(line.length <= 500 ? line : truncateLine(line).text);
  }
  const rawOutput = formatted.join("\n");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let text = truncation.content || "(no matches)";
  if (truncation.truncated) text += `\n\n[${formatSize(DEFAULT_MAX_BYTES)} limit reached]`;
  return { text, truncation, matchCount: formatted.length };
}

export async function toolFind(cwd, { pattern = ".", path: searchPath = "." } = {}) {
  if (preferNative()) {
    try {
      const text = await nativeCall("find", { cwd, pattern, path: searchPath });
      if (text != null) return { text, truncation: null };
    } catch {
      /* JS fallback */
    }
  }
  const fdArgs = ["--no-require-git", "--type", "f"];
  if (pattern && pattern !== ".") fdArgs.push("--glob", pattern);
  else fdArgs.push(".");
  fdArgs.push(searchPath);
  const { code, stdout, stderr } = await runSpawn("fd", fdArgs, { cwd });
  if (code !== 0 && code !== 1) throw new Error(stderr.trim() || `fd exited ${code}`);
  const rawOutput = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let text = truncation.content || "(no results)";
  if (truncation.truncated) text += `\n\n[${formatSize(DEFAULT_MAX_BYTES)} limit reached]`;
  return { text, truncation };
}

export async function toolBash(cwd, { command }) {
  if (preferNative()) {
    try {
      const text = await nativeCall("bash", { cwd, command });
      if (text != null) return { text, truncation: null, exitCode: 0 };
    } catch {
      /* JS fallback */
    }
  }
  const { code, stdout, stderr } = await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [],
      err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (c) =>
      resolve({
        code: c,
        stdout: Buffer.concat(out).toString("utf-8"),
        stderr: Buffer.concat(err).toString("utf-8"),
      }),
    );
  });
  const combined = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
  const truncation = truncateTail(combined);
  return { text: truncation.content, truncation, exitCode: code };
}

export const MODE = "fast";
