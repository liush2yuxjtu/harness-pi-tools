import { readFile, writeFile, access, mkdir, readdir, stat, constants } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { truncateHead, truncateHeadFromSplit, truncateTail, truncateLine, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "./truncate.mjs";

const DEFAULT_LS_LIMIT = 500;

export async function toolRead(cwd, { filePath, offset, limit }) {
  const absolutePath = path.resolve(cwd, filePath);
  await access(absolutePath, constants.R_OK);
  const buffer = await readFile(absolutePath);
  const textContent = buffer.toString("utf-8");
  const allLines = textContent.split("\n");
  const totalFileLines = allLines.length;
  const startLine = offset ? Math.max(0, offset - 1) : 0;
  const startLineDisplay = startLine + 1;
  if (startLine >= allLines.length) throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
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
    // Whole-file: under-limit → truncateHead no-alloc path; over-limit → reuse allLines (no re-split).
    const totalBytes = Buffer.byteLength(textContent, "utf-8");
    const countingLines = textContent.endsWith("\n") ? allLines.length - 1 : allLines.length;
    if (countingLines <= DEFAULT_MAX_LINES && totalBytes <= DEFAULT_MAX_BYTES) {
      truncation = truncateHead(textContent);
    } else {
      truncation = truncateHeadFromSplit(allLines);
    }
  } else {
    truncation = truncateHeadFromSplit(selectedSplit);
  }
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

export async function toolWrite(cwd, { filePath, content }) {
  const absolutePath = path.resolve(cwd, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
  return { text: `Successfully wrote to ${filePath}` };
}

export async function toolEdit(cwd, { filePath, edits }) {
  const absolutePath = path.resolve(cwd, filePath);
  await access(absolutePath, constants.R_OK | constants.W_OK);
  let text = (await readFile(absolutePath)).toString("utf-8");
  for (const { oldText, newText } of edits) {
    const idx = text.indexOf(oldText);
    if (idx < 0) throw new Error(`oldText not found in ${filePath}`);
    if (text.indexOf(oldText, idx + 1) >= 0) throw new Error(`oldText not unique in ${filePath}`);
    text = text.slice(0, idx) + newText + text.slice(idx + oldText.length);
  }
  await writeFile(absolutePath, text, "utf-8");
  return { text: `Successfully edited ${filePath}` };
}

export async function toolLs(cwd, { dirPath, limit } = {}) {
  const absolute = path.resolve(cwd, dirPath || ".");
  const st = await stat(absolute);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${absolute}`);
  const effectiveLimit = limit ?? DEFAULT_LS_LIMIT;
  // FAST: withFileTypes avoids per-entry stat syscall
  const dirents = await readdir(absolute, { withFileTypes: true });
  dirents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const results = [];
  let entryLimitReached = false;
  for (const d of dirents) {
    if (results.length >= effectiveLimit) { entryLimitReached = true; break; }
    let isDir = d.isDirectory();
    // Handle symlinks similarly to stat follow? official uses stat which follows symlinks
    if (d.isSymbolicLink()) {
      try {
        const entryStat = await stat(path.join(absolute, d.name));
        isDir = entryStat.isDirectory();
      } catch { continue; }
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
      resolve({ code, stdout: Buffer.concat(chunks).toString("utf-8"), stderr: Buffer.concat(errChunks).toString("utf-8") });
    });
  });
}

export async function toolGrep(cwd, { pattern, path: searchPath = ".", glob }) {
  const args = ["--no-config", "--line-number", "--color", "never", "--sort", "path", pattern];
  if (glob) args.push("--glob", glob);
  args.push(searchPath);
  const { code, stdout, stderr } = await runSpawn("rg", args, { cwd });
  if (code !== 0 && code !== 1) throw new Error(stderr.trim() || `ripgrep exited ${code}`);
  const lines = stdout.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === ""));
  const formatted = [];
  for (const line of lines) {
    const { text } = truncateLine(line.replace(/\0/g, ""));
    formatted.push(text);
  }
  const rawOutput = formatted.join("\n");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let text = truncation.content || "(no matches)";
  if (truncation.truncated) text += `\n\n[${formatSize(DEFAULT_MAX_BYTES)} limit reached]`;
  return { text, truncation, matchCount: formatted.length };
}

export async function toolFind(cwd, { pattern = ".", path: searchPath = "." } = {}) {
  const fdArgs = ["--no-require-git", "--type", "f"];
  if (pattern && pattern !== ".") fdArgs.push("--glob", pattern);
  else fdArgs.push(".");
  fdArgs.push(searchPath);
  const { code, stdout, stderr } = await runSpawn("fd", fdArgs, { cwd });
  if (code !== 0 && code !== 1) throw new Error(stderr.trim() || `fd exited ${code}`);
  const rawOutput = stdout.replace(/\n$/, "");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let text = truncation.content || "(no results)";
  if (truncation.truncated) text += `\n\n[${formatSize(DEFAULT_MAX_BYTES)} limit reached]`;
  return { text, truncation };
}

export async function toolBash(cwd, { command }) {
  const { code, stdout, stderr } = await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (c) => resolve({ code: c, stdout: Buffer.concat(out).toString("utf-8"), stderr: Buffer.concat(err).toString("utf-8") }));
  });
  const combined = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
  const truncation = truncateTail(combined);
  return { text: truncation.content, truncation, exitCode: code };
}

export const MODE = "fast";
