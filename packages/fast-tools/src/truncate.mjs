/** Fast truncate — same public semantics as official pin (2000 lines / 50KB). */
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function splitLinesForCounting(content) {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function countLinesNoAlloc(content) {
  if (content.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return content.charCodeAt(content.length - 1) === 10 ? n : n + 1;
}

function truncateFromCountingLines(lines, totalBytes, maxLines, maxBytes, underLimitContent) {
  const totalLines = lines.length;
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content: underLimitContent,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }
  if (lines.length && Buffer.byteLength(lines[0], "utf-8") > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true,
      maxLines,
      maxBytes,
    };
  }
  // Already under byte cap → must be line truncation; skip per-line byteLength.
  if (totalBytes <= maxBytes) {
    const outputContent = lines.slice(0, maxLines).join("\n");
    return {
      content: outputContent,
      truncated: true,
      truncatedBy: "lines",
      totalLines,
      totalBytes,
      outputLines: maxLines,
      outputBytes: Buffer.byteLength(outputContent, "utf-8"),
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }
  const outputLinesArr = [];
  let outputBytesCount = 0;
  let truncatedBy = "lines";
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0);
    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    outputLinesArr.push(line);
    outputBytesCount += lineBytes;
  }
  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) truncatedBy = "lines";
  const outputContent = outputLinesArr.join("\n");
  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: Buffer.byteLength(outputContent, "utf-8"),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

export function truncateHead(content, options = {}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = Buffer.byteLength(content, "utf-8");

  if (content.length === 0) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines: 0,
      totalBytes: 0,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  // Under-limit fast path:
  // Prefer native split for small payloads (Valgrind Ir: C++ split << JS charCodeAt loop).
  // Larger under-byte payloads: countLinesNoAlloc avoids string[] when returning under-limit.
  if (totalBytes <= maxBytes) {
    if (content.length < 16384) {
      const lines = splitLinesForCounting(content);
      if (lines.length <= maxLines) {
        return {
          content,
          truncated: false,
          truncatedBy: null,
          totalLines: lines.length,
          totalBytes,
          outputLines: lines.length,
          outputBytes: totalBytes,
          lastLinePartial: false,
          firstLineExceedsLimit: false,
          maxLines,
          maxBytes,
        };
      }
      return truncateFromCountingLines(lines, totalBytes, maxLines, maxBytes, content);
    }
    const totalLines = countLinesNoAlloc(content);
    if (totalLines <= maxLines) {
      return {
        content,
        truncated: false,
        truncatedBy: null,
        totalLines,
        totalBytes,
        outputLines: totalLines,
        outputBytes: totalBytes,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines,
        maxBytes,
      };
    }
  }

  const lines = splitLinesForCounting(content);
  return truncateFromCountingLines(lines, totalBytes, maxLines, maxBytes, content);
}

/**
 * Prefer this from toolRead when lines are already split via `content.split("\\n")`.
 * Pass totalBytes / underLimitContent to skip joining the full file when over the line cap.
 */
export function truncateHeadFromSplit(splitLines, options = {}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines =
    splitLines.length > 0 && splitLines[splitLines.length - 1] === ""
      ? splitLines.slice(0, -1)
      : splitLines;

  let totalBytes = options.totalBytes;
  let underLimitContent = options.underLimitContent;
  if (totalBytes === undefined || underLimitContent === undefined) {
    const joined = splitLines.join("\n");
    if (underLimitContent === undefined) underLimitContent = joined;
    if (totalBytes === undefined) totalBytes = Buffer.byteLength(joined, "utf-8");
  }

  return truncateFromCountingLines(lines, totalBytes, maxLines, maxBytes, underLimitContent);
}

/** Build an under-limit truncation record without splitting or joining. */
export function underLimitTruncation(content, totalBytes, totalLines) {
  return {
    content,
    truncated: false,
    truncatedBy: null,
    totalLines,
    totalBytes,
    outputLines: totalLines,
    outputBytes: totalBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  };
}

export { countLinesNoAlloc };

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
  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
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
  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: Buffer.byteLength(outputContent, "utf-8"),
    lastLinePartial,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

export function truncateLine(line, maxChars = GREP_MAX_LINE_LENGTH) {
  if (line.length <= maxChars) return { text: line, wasTruncated: false };
  return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}
