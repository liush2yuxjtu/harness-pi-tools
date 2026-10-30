/** Optimized truncate with same public semantics as official pin defaults. */
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function countLinesAndBytes(content) {
  const buf = Buffer.from(content, "utf-8");
  let lines = 0;
  if (buf.length === 0) return { buf, totalLines: 0, totalBytes: 0 };
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) lines++;
  // trailing non-newline content counts as a line (same as splitLinesForCounting)
  if (buf[buf.length - 1] !== 0x0a) lines++;
  // splitLinesForCounting: if ends with \n, pop empty → line count = number of \n
  // Actually: "a\nb\n".split → ["a","b",""] pop → ["a","b"] = 2 = number of \n
  // "a\nb".split → ["a","b"] = 2 = number of \n + 1 if no trailing
  // So: totalLines = count(\n) if ends with \n else count(\n)+1; empty=0
  let totalLines = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) totalLines++;
  if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) totalLines++;
  // Wait - "a\nb\n": newlines=2, ends with \n → official pops empty → 2 lines. Good (totalLines=2).
  // "a\nb": newlines=1, no trailing → official 2 lines. We need totalLines = newlines + (no trailing? 1 : 0)
  // Recalc properly:
  totalLines = 0;
  if (buf.length === 0) return { buf, totalLines: 0, totalBytes: buf.length };
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
  if (buf[buf.length - 1] === 0x0a) totalLines = n; else totalLines = n + 1;
  return { buf, totalLines, totalBytes: buf.length };
}

/** Decode line slices from buffer without building full string array first when truncating. */
export function truncateHead(content, options = {}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const { buf, totalLines, totalBytes } = countLinesAndBytes(content);
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, truncatedBy: null, totalLines, totalBytes, outputLines: totalLines, outputBytes: totalBytes, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
  }
  // Walk lines
  const lines = [];
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      const end = i;
      // if content ends with \n, last empty segment is dropped (match official)
      if (i === buf.length && buf.length > 0 && buf[buf.length - 1] === 0x0a) break;
      lines.push(buf.subarray(start, end));
      start = i + 1;
    }
  }
  if (lines.length && lines[0].length > maxBytes) {
    return { content: "", truncated: true, truncatedBy: "bytes", totalLines, totalBytes, outputLines: 0, outputBytes: 0, lastLinePartial: false, firstLineExceedsLimit: true, maxLines, maxBytes };
  }
  const out = [];
  let outputBytesCount = 0;
  let truncatedBy = "lines";
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const lineBytes = lines[i].length + (i > 0 ? 1 : 0);
    if (outputBytesCount + lineBytes > maxBytes) { truncatedBy = "bytes"; break; }
    out.push(lines[i]);
    outputBytesCount += lineBytes;
  }
  if (out.length >= maxLines && outputBytesCount <= maxBytes) truncatedBy = "lines";
  const outputContent = Buffer.concat(out.map((b, i) => (i === 0 ? b : Buffer.concat([Buffer.from("\n"), b])))).toString("utf-8");
  // simpler join:
  const parts = [];
  for (let i = 0; i < out.length; i++) {
    if (i) parts.push(Buffer.from("\n"));
    parts.push(out[i]);
  }
  const joined = Buffer.concat(parts);
  return { content: joined.toString("utf-8"), truncated: true, truncatedBy, totalLines, totalBytes, outputLines: out.length, outputBytes: joined.length, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
}

function truncateStringToBytesFromEnd(str, maxBytes) {
  const buf = Buffer.from(str, "utf-8");
  if (buf.length <= maxBytes) return str;
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return buf.slice(start).toString("utf-8");
}

export function truncateTail(content, options = {}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = Buffer.byteLength(content, "utf-8");
  // For parity-critical path, reuse line split equivalent
  const lines = [];
  if (content.length) {
    const raw = content.split("\n");
    if (content.endsWith("\n")) raw.pop();
    lines.push(...raw);
  }
  const totalLines = lines.length;
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, truncatedBy: null, totalLines, totalBytes, outputLines: totalLines, outputBytes: totalBytes, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
  }
  const outputLinesArr = [];
  let outputBytesCount = 0;
  let truncatedBy = "lines";
  let lastLinePartial = false;
  for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < maxLines; i--) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLinesArr.length > 0 ? 1 : 0);
    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      if (outputLinesArr.length === 0) {
        const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
        outputLinesArr.unshift(truncatedLine);
        outputBytesCount = Buffer.byteLength(truncatedLine, "utf-8");
        lastLinePartial = true;
      }
      break;
    }
    outputLinesArr.unshift(line);
    outputBytesCount += lineBytes;
  }
  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) truncatedBy = "lines";
  const outputContent = outputLinesArr.join("\n");
  return { content: outputContent, truncated: true, truncatedBy, totalLines, totalBytes, outputLines: outputLinesArr.length, outputBytes: Buffer.byteLength(outputContent, "utf-8"), lastLinePartial, firstLineExceedsLimit: false, maxLines, maxBytes };
}

export function truncateLine(line, maxChars = GREP_MAX_LINE_LENGTH) {
  if (line.length <= maxChars) return { text: line, wasTruncated: false };
  return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}
