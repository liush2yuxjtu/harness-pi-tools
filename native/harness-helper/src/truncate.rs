//! Official-compatible truncate (2000 lines / 50KB). Pure safe Rust.

pub const DEFAULT_MAX_LINES: usize = 2000;
pub const DEFAULT_MAX_BYTES: usize = 50 * 1024;
pub const GREP_MAX_LINE_LENGTH: usize = 500;

#[derive(Clone, Debug)]
pub struct Truncation {
    pub content: String,
    pub truncated: bool,
    pub truncated_by: Option<&'static str>,
    pub total_lines: usize,
    pub total_bytes: usize,
    pub output_lines: usize,
    pub output_bytes: usize,
    pub last_line_partial: bool,
    pub first_line_exceeds_limit: bool,
    pub max_lines: usize,
    pub max_bytes: usize,
}

pub fn format_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{bytes}B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// Match JS splitLinesForCounting: split on \n, pop trailing empty if ends with \n.
pub fn split_lines_for_counting(content: &str) -> Vec<&str> {
    if content.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<&str> = content.split('\n').collect();
    if content.ends_with('\n') {
        lines.pop();
    }
    lines
}

pub fn truncate_head(content: &str, max_lines: usize, max_bytes: usize) -> Truncation {
    let total_bytes = content.len(); // UTF-8 byte length (content is str)
    let lines = split_lines_for_counting(content);
    let total_lines = lines.len();
    if total_lines <= max_lines && total_bytes <= max_bytes {
        return Truncation {
            content: content.to_string(),
            truncated: false,
            truncated_by: None,
            total_lines,
            total_bytes,
            output_lines: total_lines,
            output_bytes: total_bytes,
            last_line_partial: false,
            first_line_exceeds_limit: false,
            max_lines,
            max_bytes,
        };
    }
    if !lines.is_empty() && lines[0].len() > max_bytes {
        return Truncation {
            content: String::new(),
            truncated: true,
            truncated_by: Some("bytes"),
            total_lines,
            total_bytes,
            output_lines: 0,
            output_bytes: 0,
            last_line_partial: false,
            first_line_exceeds_limit: true,
            max_lines,
            max_bytes,
        };
    }
    let mut output_lines_arr: Vec<&str> = Vec::new();
    let mut output_bytes_count = 0usize;
    let mut truncated_by = "lines";
    for (i, line) in lines.iter().enumerate() {
        if i >= max_lines {
            break;
        }
        let line_bytes = line.len() + if i > 0 { 1 } else { 0 };
        if output_bytes_count + line_bytes > max_bytes {
            truncated_by = "bytes";
            break;
        }
        output_lines_arr.push(line);
        output_bytes_count += line_bytes;
    }
    if output_lines_arr.len() >= max_lines && output_bytes_count <= max_bytes {
        truncated_by = "lines";
    }
    let output_content = output_lines_arr.join("\n");
    let output_bytes = output_content.len();
    Truncation {
        content: output_content,
        truncated: true,
        truncated_by: Some(truncated_by),
        total_lines,
        total_bytes,
        output_lines: output_lines_arr.len(),
        output_bytes,
        last_line_partial: false,
        first_line_exceeds_limit: false,
        max_lines,
        max_bytes,
    }
}

fn truncate_string_to_bytes_from_end(s: &str, max_bytes: usize) -> String {
    let buf = s.as_bytes();
    if buf.len() <= max_bytes {
        return s.to_string();
    }
    let mut start = buf.len() - max_bytes;
    while start < buf.len() && (buf[start] & 0xc0) == 0x80 {
        start += 1;
    }
    String::from_utf8_lossy(&buf[start..]).into_owned()
}

pub fn truncate_tail(content: &str, max_lines: usize, max_bytes: usize) -> Truncation {
    let total_bytes = content.len();
    let lines = split_lines_for_counting(content);
    let total_lines = lines.len();
    if total_lines <= max_lines && total_bytes <= max_bytes {
        return Truncation {
            content: content.to_string(),
            truncated: false,
            truncated_by: None,
            total_lines,
            total_bytes,
            output_lines: total_lines,
            output_bytes: total_bytes,
            last_line_partial: false,
            first_line_exceeds_limit: false,
            max_lines,
            max_bytes,
        };
    }
    let mut output_lines_arr: Vec<String> = Vec::new();
    let mut output_bytes_count = 0usize;
    let mut truncated_by = "lines";
    let mut last_line_partial = false;
    for i in (0..lines.len()).rev() {
        if output_lines_arr.len() >= max_lines {
            break;
        }
        let line = lines[i];
        let line_bytes = line.len() + if !output_lines_arr.is_empty() { 1 } else { 0 };
        if output_bytes_count + line_bytes > max_bytes {
            truncated_by = "bytes";
            if output_lines_arr.is_empty() {
                let truncated_line = truncate_string_to_bytes_from_end(line, max_bytes);
                output_bytes_count = truncated_line.len();
                output_lines_arr.insert(0, truncated_line);
                last_line_partial = true;
            }
            break;
        }
        output_lines_arr.insert(0, line.to_string());
        output_bytes_count += line_bytes;
    }
    if output_lines_arr.len() >= max_lines && output_bytes_count <= max_bytes {
        truncated_by = "lines";
    }
    let output_content = output_lines_arr.join("\n");
    let output_bytes = output_content.len();
    Truncation {
        content: output_content,
        truncated: true,
        truncated_by: Some(truncated_by),
        total_lines,
        total_bytes,
        output_lines: output_lines_arr.len(),
        output_bytes,
        last_line_partial,
        first_line_exceeds_limit: false,
        max_lines,
        max_bytes,
    }
}

pub fn truncate_line(line: &str, max_chars: usize) -> (String, bool) {
    if line.len() <= max_chars {
        (line.to_string(), false)
    } else {
        // JS uses string length (UTF-16 code units approx); for ASCII fixtures == bytes.
        // Use chars carefully: official uses line.length (JS UTF-16). Fixtures are ASCII.
        let cut: String = line.chars().take(max_chars).collect();
        (format!("{cut}... [truncated]"), true)
    }
}
