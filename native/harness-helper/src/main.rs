//! HARNESS native helper — Ir worker + oneshot tools. `forbid(unsafe)`.
#![forbid(unsafe_code)]

mod tools;
mod truncate;

use std::env;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

fn fixture_root() -> PathBuf {
    if let Ok(p) = env::var("HARNESS_FIXTURE") {
        return PathBuf::from(p);
    }
    // native/harness-helper → repo root
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p.join("fixture")
}

fn repo_bin_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p.join("bin")
}

fn ensure_path() {
    let bin = repo_bin_path();
    if bin.is_dir() {
        let old = env::var("PATH").unwrap_or_default();
        let new = format!("{}:{}", bin.display(), old);
        // single-threaded startup only
        env::set_var("PATH", new);
    }
}

fn run_scenario(scenario: &str, fixture: &Path) -> Result<String, String> {
    match scenario {
        "read:small" => tools::tool_read(fixture, "src/js/hello.js", None, None),
        "read:boundary-lines" => tools::tool_read(fixture, "boundary/lines_2500.txt", None, None),
        "read:large-2mb" => tools::tool_read(fixture, "large/big_2_5mb.txt", None, None),
        "read:near-2000" => tools::tool_read(fixture, "large/near_2000_lines.txt", None, None),
        "read:near-50kb" => tools::tool_read(fixture, "large/near_50kb.txt", None, None),
        "bash" => tools::tool_bash(fixture, "seq 1 3000"),
        "edit" => {
            let rel = "edit_sandbox/target_ir_native.txt";
            let path = fixture.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&path, b"alpha\nbeta\ngamma\n").map_err(|e| e.to_string())?;
            tools::tool_edit(fixture, rel, &[("beta", "BETA")])
        }
        "write" => tools::tool_write(
            fixture,
            "write_sandbox/out_ir_native.txt",
            &"hello harness\n".repeat(100),
        ),
        "grep" => tools::tool_grep(fixture, "ALPHA", "src/js", None),
        "find" => tools::tool_find(fixture, "*.js", "src"),
        "ls" => tools::tool_ls(fixture, "src/js", None),
        "ls:dir-2k" => tools::tool_ls(fixture, "large/dir_2k", None),
        "find:dir-2k" => tools::tool_find(fixture, "*.txt", "large/dir_2k"),
        "grep:large-2mb" => tools::tool_grep(fixture, "ALPHA", "large/big_2_5mb.txt", None),
        _ => Err(format!("unknown scenario {scenario}")),
    }
}

fn cmd_ir_worker(scenario: &str, rounds: u64) -> i32 {
    ensure_path();
    let fixture = fixture_root();
    // warmup + N rounds (match node ir-worker.mjs)
    match run_scenario(scenario, &fixture) {
        Ok(_) => {}
        Err(e) => {
            eprintln!("warmup failed: {e}");
            return 2;
        }
    }
    for _ in 0..rounds {
        if let Err(e) = run_scenario(scenario, &fixture) {
            eprintln!("round failed: {e}");
            return 2;
        }
    }
    println!(
        "{{\"ok\":true,\"mode\":\"native\",\"scenario\":\"{}\",\"rounds\":{}}}",
        scenario, rounds
    );
    0
}

fn cmd_oneshot(args: &[String]) -> i32 {
    ensure_path();
    // oneshot <cwd> <op> ...
    if args.len() < 2 {
        eprintln!("usage: harness-helper oneshot <cwd> <op> ...");
        return 2;
    }
    let cwd = PathBuf::from(&args[0]);
    let op = args[1].as_str();
    let result = match op {
        "read" => {
            let path = args.get(2).map(|s| s.as_str()).unwrap_or("");
            let offset = args.get(3).and_then(|s| s.parse().ok());
            let limit = args.get(4).and_then(|s| s.parse().ok());
            tools::tool_read(&cwd, path, offset, limit)
        }
        "write" => {
            let path = args.get(2).map(|s| s.as_str()).unwrap_or("");
            let content = args.get(3).map(|s| s.as_str()).unwrap_or("");
            tools::tool_write(&cwd, path, content)
        }
        "edit" => {
            // edit <path> <old> <new>  (single edit for harness)
            let path = args.get(2).map(|s| s.as_str()).unwrap_or("");
            let old = args.get(3).map(|s| s.as_str()).unwrap_or("");
            let new = args.get(4).map(|s| s.as_str()).unwrap_or("");
            tools::tool_edit(&cwd, path, &[(old, new)])
        }
        "ls" => {
            let path = args.get(2).map(|s| s.as_str()).unwrap_or(".");
            let limit = args.get(3).and_then(|s| s.parse().ok());
            tools::tool_ls(&cwd, path, limit)
        }
        "bash" => {
            let cmd = args.get(2).map(|s| s.as_str()).unwrap_or("");
            tools::tool_bash(&cwd, cmd)
        }
        "grep" => {
            let pattern = args.get(2).map(|s| s.as_str()).unwrap_or("");
            let path = args.get(3).map(|s| s.as_str()).unwrap_or(".");
            let glob = args.get(4).map(|s| s.as_str());
            tools::tool_grep(&cwd, pattern, path, glob)
        }
        "find" => {
            let pattern = args.get(2).map(|s| s.as_str()).unwrap_or(".");
            let path = args.get(3).map(|s| s.as_str()).unwrap_or(".");
            tools::tool_find(&cwd, pattern, path)
        }
        _ => Err(format!("unknown op {op}")),
    };
    match result {
        Ok(text) => {
            // Emit length-prefixed to allow binary-safe? For harness text is fine as JSON string.
            // Use a simple framing: first line = JSON meta with byte length, then raw text bytes.
            let mut out = io::stdout().lock();
            let meta = format!("{{\"ok\":true,\"bytes\":{}}}\n", text.len());
            let _ = out.write_all(meta.as_bytes());
            let _ = out.write_all(text.as_bytes());
            0
        }
        Err(e) => {
            let mut out = io::stdout().lock();
            let _ = writeln!(out, "{{\"ok\":false,\"error\":{}}}", json_escape(&e));
            1
        }
    }
}

fn json_escape(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Long-lived JSONL protocol: one request per line.
/// {"op":"read","cwd":"...","path":"...","offset":null,"limit":null}
/// Response: {"ok":true,"text":"..."} or {"ok":false,"error":"..."}
fn cmd_serve() -> i32 {
    ensure_path();
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                let _ = writeln!(stdout, "{{\"ok\":false,\"error\":{}}}", json_escape(&e.to_string()));
                let _ = stdout.flush();
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        if line.trim() == "quit" {
            break;
        }
        let resp = handle_serve_line(&line);
        let _ = writeln!(stdout, "{resp}");
        let _ = stdout.flush();
    }
    0
}

fn handle_serve_line(line: &str) -> String {
    // Minimal JSON field extraction without serde (keep dep-free).
    let op = extract_string(line, "op").unwrap_or_default();
    let cwd = extract_string(line, "cwd").unwrap_or_else(|| ".".into());
    let cwd = PathBuf::from(cwd);
    let result = match op.as_str() {
        "read" => {
            let path = extract_string(line, "path").unwrap_or_default();
            let offset = extract_u64(line, "offset");
            let limit = extract_u64(line, "limit");
            tools::tool_read(&cwd, &path, offset, limit)
        }
        "write" => {
            let path = extract_string(line, "path").unwrap_or_default();
            let content = extract_string(line, "content").unwrap_or_default();
            tools::tool_write(&cwd, &path, &content)
        }
        "edit" => {
            let path = extract_string(line, "path").unwrap_or_default();
            let old = extract_string(line, "oldText").unwrap_or_default();
            let new = extract_string(line, "newText").unwrap_or_default();
            tools::tool_edit(&cwd, &path, &[(&old, &new)])
        }
        "ls" => {
            let path = extract_string(line, "path").unwrap_or_else(|| ".".into());
            let limit = extract_u64(line, "limit");
            tools::tool_ls(&cwd, &path, limit)
        }
        "bash" => {
            let command = extract_string(line, "command").unwrap_or_default();
            tools::tool_bash(&cwd, &command)
        }
        "grep" => {
            let pattern = extract_string(line, "pattern").unwrap_or_default();
            let path = extract_string(line, "path").unwrap_or_else(|| ".".into());
            let glob = extract_string(line, "glob");
            tools::tool_grep(&cwd, &pattern, &path, glob.as_deref())
        }
        "find" => {
            let pattern = extract_string(line, "pattern").unwrap_or_else(|| ".".into());
            let path = extract_string(line, "path").unwrap_or_else(|| ".".into());
            tools::tool_find(&cwd, &pattern, &path)
        }
        "ping" => Ok("pong".into()),
        _ => Err(format!("unknown op {op}")),
    };
    match result {
        Ok(text) => format!("{{\"ok\":true,\"text\":{}}}", json_escape(&text)),
        Err(e) => format!("{{\"ok\":false,\"error\":{}}}", json_escape(&e)),
    }
}

fn extract_string(json: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\"");
    let i = json.find(&pat)?;
    let rest = &json[i + pat.len()..];
    let rest = rest.trim_start();
    if !rest.starts_with(':') {
        return None;
    }
    let rest = rest[1..].trim_start();
    if rest.starts_with("null") {
        return None;
    }
    if !rest.starts_with('"') {
        return None;
    }
    let mut out = String::new();
    let bytes = rest.as_bytes();
    let mut i = 1;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => return Some(out),
            b'\\' if i + 1 < bytes.len() => {
                match bytes[i + 1] {
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'u' if i + 5 < bytes.len() => {
                        // skip crude \uXXXX
                        out.push('?');
                        i += 4;
                    }
                    c => out.push(c as char),
                }
                i += 2;
            }
            c => {
                out.push(c as char);
                i += 1;
            }
        }
    }
    None
}

fn extract_u64(json: &str, key: &str) -> Option<u64> {
    let pat = format!("\"{key}\"");
    let i = json.find(&pat)?;
    let rest = &json[i + pat.len()..];
    let rest = rest.trim_start();
    if !rest.starts_with(':') {
        return None;
    }
    let rest = rest[1..].trim_start();
    if rest.starts_with("null") {
        return None;
    }
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!(
            "usage: harness-helper ir-worker <scenario> <rounds> | serve | oneshot <cwd> <op> ..."
        );
        std::process::exit(2);
    }
    let cmd = args.remove(0);
    let code = match cmd.as_str() {
        "ir-worker" => {
            let scenario = args.first().map(|s| s.as_str()).unwrap_or("");
            let rounds = args
                .get(1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(20u64);
            cmd_ir_worker(scenario, rounds)
        }
        "serve" => cmd_serve(),
        "oneshot" => cmd_oneshot(&args),
        // allow: harness-helper <scenario> <rounds>  as shorthand for ir-worker
        other if args.len() <= 1 => {
            let rounds = args
                .first()
                .and_then(|s| s.parse().ok())
                .unwrap_or(20u64);
            cmd_ir_worker(other, rounds)
        }
        _ => {
            eprintln!("unknown command {cmd}");
            2
        }
    };
    std::process::exit(code);
}
