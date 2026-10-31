//! Native implementations of Pi coding-agent tools (parity with official-shim).

use crate::truncate::{
    format_size, truncate_head, truncate_line, truncate_tail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES,
    GREP_MAX_LINE_LENGTH,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn resolve(cwd: &Path, rel: &str) -> PathBuf {
    if Path::new(rel).is_absolute() {
        PathBuf::from(rel)
    } else {
        cwd.join(rel)
    }
}

pub fn tool_read(
    cwd: &Path,
    file_path: &str,
    offset: Option<u64>,
    limit: Option<u64>,
) -> Result<String, String> {
    let absolute = resolve(cwd, file_path);
    let buffer = fs::read(&absolute).map_err(|e| e.to_string())?;
    let text_content = String::from_utf8_lossy(&buffer).into_owned();
    // Match JS: split("\n") keeps trailing empty element
    let all_lines: Vec<&str> = text_content.split('\n').collect();
    let total_file_lines = all_lines.len();
    let start_line = offset.map(|o| o.saturating_sub(1) as usize).unwrap_or(0);
    let start_line_display = start_line + 1;
    if start_line >= all_lines.len() {
        return Err(format!(
            "Offset {offset:?} is beyond end of file ({total_file_lines} lines total)"
        ));
    }

    let (selected_content, user_limited_lines): (String, Option<usize>) = if let Some(lim) = limit {
        let end = (start_line + lim as usize).min(all_lines.len());
        let selected = all_lines[start_line..end].join("\n");
        (selected, Some(end - start_line))
    } else {
        (all_lines[start_line..].join("\n"), None)
    };

    let truncation = truncate_head(&selected_content, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);

    let output_text = if truncation.first_line_exceeds_limit {
        let first_bytes = all_lines[start_line].len();
        format!(
            "[Line {start_line_display} is {}, exceeds {} limit. Use bash: sed -n '{start_line_display}p' {file_path} | head -c {DEFAULT_MAX_BYTES}]",
            format_size(first_bytes),
            format_size(DEFAULT_MAX_BYTES)
        )
    } else if truncation.truncated {
        let end_line_display = start_line_display + truncation.output_lines - 1;
        let next_offset = end_line_display + 1;
        let mut out = truncation.content.clone();
        if truncation.truncated_by == Some("lines") {
            out.push_str(&format!(
                "\n\n[Showing lines {start_line_display}-{end_line_display} of {total_file_lines}. Use offset={next_offset} to continue.]"
            ));
        } else {
            out.push_str(&format!(
                "\n\n[Showing lines {start_line_display}-{end_line_display} of {total_file_lines} ({} limit). Use offset={next_offset} to continue.]",
                format_size(DEFAULT_MAX_BYTES)
            ));
        }
        out
    } else if let Some(ull) = user_limited_lines {
        if start_line + ull < all_lines.len() {
            let remaining = all_lines.len() - (start_line + ull);
            let next_offset = start_line + ull + 1;
            format!(
                "{}\n\n[{remaining} more lines in file. Use offset={next_offset} to continue.]",
                truncation.content
            )
        } else {
            truncation.content
        }
    } else {
        truncation.content
    };
    Ok(output_text)
}

pub fn tool_write(cwd: &Path, file_path: &str, content: &str) -> Result<String, String> {
    let absolute = resolve(cwd, file_path);
    if let Some(parent) = absolute.parent() {
        // try write first; mkdir on failure — match fast JS path semantics for existence
        if let Err(e) = fs::write(&absolute, content.as_bytes()) {
            if e.kind() == std::io::ErrorKind::NotFound {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                fs::write(&absolute, content.as_bytes()).map_err(|e| e.to_string())?;
            } else {
                return Err(e.to_string());
            }
        }
    } else {
        fs::write(&absolute, content.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(format!("Successfully wrote to {file_path}"))
}

pub fn tool_edit(cwd: &Path, file_path: &str, edits: &[(&str, &str)]) -> Result<String, String> {
    let absolute = resolve(cwd, file_path);
    let mut text = fs::read_to_string(&absolute).map_err(|e| e.to_string())?;
    for (old, new) in edits {
        let idx = text.find(old).ok_or_else(|| format!("oldText not found in {file_path}"))?;
        if let Some(rest) = text.get(idx + old.len()..) {
            if rest.contains(old) {
                return Err(format!("oldText not unique in {file_path}"));
            }
        }
        text.replace_range(idx..idx + old.len(), new);
    }
    fs::write(&absolute, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(format!("Successfully edited {file_path}"))
}

pub fn tool_ls(cwd: &Path, dir_path: &str, limit: Option<u64>) -> Result<String, String> {
    let absolute = resolve(cwd, dir_path);
    let meta = fs::metadata(&absolute).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err(format!("Not a directory: {}", absolute.display()));
    }
    let effective_limit = limit.unwrap_or(500) as usize;
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(&absolute)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by(|a, b| {
        let an = a.file_name().to_string_lossy().to_lowercase();
        let bn = b.file_name().to_string_lossy().to_lowercase();
        an.cmp(&bn)
    });
    let mut results: Vec<String> = Vec::new();
    let mut entry_limit_reached = false;
    for ent in entries {
        if results.len() >= effective_limit {
            entry_limit_reached = true;
            break;
        }
        let name = ent.file_name().to_string_lossy().into_owned();
        let ft = ent.file_type().map_err(|e| e.to_string())?;
        let mut is_dir = ft.is_dir();
        if ft.is_symlink() {
            match fs::metadata(ent.path()) {
                Ok(m) => is_dir = m.is_dir(),
                Err(_) => continue,
            }
        }
        if is_dir {
            results.push(format!("{name}/"));
        } else {
            results.push(name);
        }
    }
    if results.is_empty() {
        return Ok("(empty directory)".into());
    }
    let raw_output = results.join("\n");
    // maxLines = MAX_SAFE_INTEGER → effectively no line cap; byte cap still applies
    let truncation = truncate_head(&raw_output, usize::MAX / 4, DEFAULT_MAX_BYTES);
    let mut output = truncation.content;
    let mut notices: Vec<String> = Vec::new();
    if entry_limit_reached {
        notices.push(format!(
            "{effective_limit} entries limit reached. Use limit={} for more",
            effective_limit * 2
        ));
    }
    if truncation.truncated {
        notices.push(format!("{} limit reached", format_size(DEFAULT_MAX_BYTES)));
    }
    if !notices.is_empty() {
        output.push_str(&format!("\n\n[{}]", notices.join(". ")));
    }
    Ok(output)
}

fn run_spawn(bin: &str, args: &[&str], cwd: &Path) -> Result<(i32, String, String), String> {
    let out = Command::new(bin)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    let code = out.status.code().unwrap_or(1);
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    Ok((code, stdout, stderr))
}

pub fn tool_grep(
    cwd: &Path,
    pattern: &str,
    search_path: &str,
    glob: Option<&str>,
) -> Result<String, String> {
    let root = resolve(cwd, search_path);
    // Large single-file: rg under Valgrind still wins vs scanning 2MB+ in-process.
    if root.is_file() {
        if let Ok(meta) = fs::metadata(&root) {
            if meta.len() > 256 * 1024 {
                return tool_grep_rg(cwd, pattern, search_path, glob);
            }
        }
    }
    // Directory / small file: in-process (amortizes away rg spawn on small suite).
    let mut paths: Vec<PathBuf> = Vec::new();
    collect_files(&root, glob, &mut paths)?;
    paths.sort_by(|a, b| {
        let ar = a.strip_prefix(cwd).unwrap_or(a);
        let br = b.strip_prefix(cwd).unwrap_or(b);
        ar.to_string_lossy().cmp(&br.to_string_lossy())
    });
    let mut formatted: Vec<String> = Vec::new();
    for path in paths {
        let rel = path
            .strip_prefix(cwd)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let data = match fs::read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if data.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&data);
        for (i, line) in text.split('\n').enumerate() {
            if line.contains(pattern) {
                let mut out_line = format!("{}:{}:{}", rel, i + 1, line);
                if out_line.contains('\0') {
                    out_line = out_line.replace('\0', "");
                }
                if out_line.len() <= GREP_MAX_LINE_LENGTH {
                    formatted.push(out_line);
                } else {
                    formatted.push(truncate_line(&out_line, GREP_MAX_LINE_LENGTH).0);
                }
            }
        }
    }
    let raw_output = formatted.join("\n");
    let truncation = truncate_head(&raw_output, usize::MAX / 4, DEFAULT_MAX_BYTES);
    let mut text = if truncation.content.is_empty() {
        "(no matches)".into()
    } else {
        truncation.content
    };
    if truncation.truncated {
        text.push_str(&format!(
            "\n\n[{} limit reached]",
            format_size(DEFAULT_MAX_BYTES)
        ));
    }
    Ok(text)
}

fn tool_grep_rg(
    cwd: &Path,
    pattern: &str,
    search_path: &str,
    glob: Option<&str>,
) -> Result<String, String> {
    let mut argv: Vec<String> = vec![
        "--no-config".into(),
        "--line-number".into(),
        "--color".into(),
        "never".into(),
        "--sort".into(),
        "path".into(),
        pattern.into(),
    ];
    if let Some(g) = glob {
        argv.push("--glob".into());
        argv.push(g.into());
    }
    argv.push(search_path.into());
    let arg_refs: Vec<&str> = argv.iter().map(|s| s.as_str()).collect();
    let (code, stdout, stderr) = run_spawn("rg", &arg_refs, cwd)?;
    if code != 0 && code != 1 {
        return Err(if stderr.trim().is_empty() {
            format!("ripgrep exited {code}")
        } else {
            stderr.trim().to_string()
        });
    }
    let ends_with_nl = stdout.ends_with('\n');
    let raw_lines: Vec<&str> = stdout.split('\n').collect();
    let n = if ends_with_nl {
        raw_lines.len().saturating_sub(1)
    } else {
        raw_lines.len()
    };
    let mut formatted: Vec<String> = Vec::with_capacity(n);
    for i in 0..n {
        let mut line = raw_lines[i].to_string();
        if line.contains('\0') {
            line = line.replace('\0', "");
        }
        if line.len() <= GREP_MAX_LINE_LENGTH {
            formatted.push(line);
        } else {
            formatted.push(truncate_line(&line, GREP_MAX_LINE_LENGTH).0);
        }
    }
    let raw_output = formatted.join("\n");
    let truncation = truncate_head(&raw_output, usize::MAX / 4, DEFAULT_MAX_BYTES);
    let mut text = if truncation.content.is_empty() {
        "(no matches)".into()
    } else {
        truncation.content
    };
    if truncation.truncated {
        text.push_str(&format!(
            "\n\n[{} limit reached]",
            format_size(DEFAULT_MAX_BYTES)
        ));
    }
    Ok(text)
}


fn collect_files(root: &Path, glob: Option<&str>, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let meta = fs::metadata(root).map_err(|e| e.to_string())?;
    if meta.is_file() {
        if glob_match(root, glob) {
            out.push(root.to_path_buf());
        }
        return Ok(());
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for ent in rd.flatten() {
            let path = ent.path();
            let ft = match ent.file_type() {
                Ok(f) => f,
                Err(_) => continue,
            };
            if ft.is_dir() {
                // skip hidden .git etc lightly
                let name = ent.file_name().to_string_lossy().into_owned();
                if name == ".git" || name == "node_modules" {
                    continue;
                }
                stack.push(path);
            } else if ft.is_file() {
                if glob_match(&path, glob) {
                    out.push(path);
                }
            }
        }
    }
    Ok(())
}

fn glob_match(path: &Path, glob: Option<&str>) -> bool {
    let Some(g) = glob else {
        return true;
    };
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    // support simple *.ext and exact
    if let Some(suf) = g.strip_prefix("*.") {
        return name.ends_with(&format!(".{suf}")) || name.ends_with(suf);
    }
    if g.starts_with('*') && g.ends_with('*') && g.len() > 2 {
        return name.contains(&g[1..g.len() - 1]);
    }
    if let Some(suf) = g.strip_prefix('*') {
        return name.ends_with(suf);
    }
    name == g
}

pub fn tool_find(cwd: &Path, pattern: &str, search_path: &str) -> Result<String, String> {
    // Prefer `fd` spawn: in-process walk of dir_2k is far worse under Valgrind Ir.
    let mut argv: Vec<String> = vec!["--no-require-git".into(), "--type".into(), "f".into()];
    if !pattern.is_empty() && pattern != "." {
        argv.push("--glob".into());
        argv.push(pattern.into());
    } else {
        argv.push(".".into());
    }
    argv.push(search_path.into());
    let arg_refs: Vec<&str> = argv.iter().map(|s| s.as_str()).collect();
    let (code, stdout, stderr) = run_spawn("fd", &arg_refs, cwd)?;
    if code != 0 && code != 1 {
        return Err(if stderr.trim().is_empty() {
            format!("fd exited {code}")
        } else {
            stderr.trim().to_string()
        });
    }
    let raw_output = if stdout.ends_with('\n') {
        stdout[..stdout.len() - 1].to_string()
    } else {
        stdout
    };
    let truncation = truncate_head(&raw_output, usize::MAX / 4, DEFAULT_MAX_BYTES);
    let mut text = if truncation.content.is_empty() {
        "(no results)".into()
    } else {
        truncation.content
    };
    if truncation.truncated {
        text.push_str(&format!(
            "\n\n[{} limit reached]",
            format_size(DEFAULT_MAX_BYTES)
        ));
    }
    Ok(text)
}

pub fn tool_bash(cwd: &Path, command: &str) -> Result<String, String> {
    let out = Command::new("bash")
        .args(["-c", command])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = if stderr.is_empty() {
        stdout.into_owned()
    } else if stdout.is_empty() {
        stderr.into_owned()
    } else {
        format!("{stdout}\n{stderr}")
    };
    let truncation = truncate_tail(&combined, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
    Ok(truncation.content)
}
