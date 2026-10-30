#!/usr/bin/env node
/**
 * Generate reproducible large fixtures (not committed).
 * Usage: node fixture/generate-large.mjs
 */
import { mkdir, writeFile, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LARGE = path.join(ROOT, "large");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(path.join(LARGE, "dir_2k"), { recursive: true });
await mkdir(path.join(LARGE, "deep", "a", "b", "c", "d", "e"), { recursive: true });

// 2000 small files for ls/find
const marker = path.join(LARGE, "dir_2k", ".generated");
if (!(await exists(marker))) {
  const batch = [];
  for (let i = 0; i < 2000; i++) {
    const name = `f_${String(i).padStart(4, "0")}.txt`;
    const body = `ALPHA seed=${i}\nline2\n`;
    batch.push(writeFile(path.join(LARGE, "dir_2k", name), body));
    if (batch.length >= 100) {
      await Promise.all(batch);
      batch.length = 0;
    }
  }
  if (batch.length) await Promise.all(batch);
  await writeFile(marker, `generatedAt=${new Date().toISOString()}\ncount=2000\n`);
  console.log("wrote large/dir_2k (2000 entries)");
} else {
  console.log("skip large/dir_2k (already generated)");
}

// ~2.5MB text (many lines) for read/grep — deterministic seed
const bigPath = path.join(LARGE, "big_2_5mb.txt");
if (!(await exists(bigPath))) {
  const lines = [];
  // ~80 chars/line * 32000 ≈ 2.5MB
  for (let i = 0; i < 32000; i++) {
    lines.push(`L${String(i).padStart(5, "0")} ALPHA ${"x".repeat(60)}`);
  }
  await writeFile(bigPath, lines.join("\n") + "\n");
  console.log("wrote large/big_2_5mb.txt");
} else {
  console.log("skip large/big_2_5mb.txt");
}

// Near truncation boundary: exactly 2000 lines under 50KB + one more line
const nearLines = path.join(LARGE, "near_2000_lines.txt");
if (!(await exists(nearLines))) {
  const lines = [];
  for (let i = 0; i < 2100; i++) lines.push(`N${i} short`);
  await writeFile(nearLines, lines.join("\n") + "\n");
  console.log("wrote large/near_2000_lines.txt");
} else {
  console.log("skip large/near_2000_lines.txt");
}

// Near 50KB boundary with fewer long lines
const nearBytes = path.join(LARGE, "near_50kb.txt");
if (!(await exists(nearBytes))) {
  const line = "B".repeat(79) + "\n"; // 80 bytes/line
  await writeFile(nearBytes, line.repeat(700)); // 56KB
  console.log("wrote large/near_50kb.txt");
} else {
  console.log("skip large/near_50kb.txt");
}

await writeFile(
  path.join(LARGE, "README.md"),
  `# Generated large fixtures

Run \`node fixture/generate-large.mjs\` to create (gitignored except this note if committed).

- dir_2k/: 2000 files for ls/find
- big_2_5mb.txt: ~2.5MB / 32k lines for read/grep
- near_2000_lines.txt / near_50kb.txt: truncation boundary stress
`,
);

console.log("done", LARGE);
