//! Streams `journalctl -f -o json` output to the frontend as `journal-log-line` events.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;

use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::LogEntry;
use crate::systemd::Scope;

pub const LOG_EVENT: &str = "journal-log-line";
pub const END_EVENT: &str = "journal-stream-ended";

/// Running streams keyed by the frontend-chosen stream id. Aborting a task drops its
/// `Child`, and `kill_on_drop` then terminates journalctl.
#[derive(Default)]
pub struct Streams(Mutex<HashMap<String, JoinHandle<()>>>);

impl Streams {
    pub fn stop(&self, stream_id: &str) {
        if let Some(task) = self.0.lock().unwrap().remove(stream_id) {
            task.abort();
        }
    }
}

pub fn start(
    app: AppHandle,
    streams: &Streams,
    stream_id: String,
    unit: String,
    scope: Scope,
    lines: u32,
) -> Result<(), String> {
    streams.stop(&stream_id);

    let mut cmd = Command::new("journalctl");
    if scope == Scope::User {
        cmd.arg("--user");
    }
    cmd.args(["-f", "-n", &lines.to_string(), "-o", "json", "-u", &unit])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start journalctl: {e}"))?;
    let stdout = child.stdout.take().ok_or("journalctl has no stdout")?;

    let id = stream_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _child = child; // kept alive (and killed on drop) for the task's lifetime
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(entry) = parse_line(&id, &line) {
                let _ = app.emit(LOG_EVENT, entry);
            }
        }
        let _ = app.emit(END_EVENT, &id);
    });
    streams.0.lock().unwrap().insert(stream_id, task);
    Ok(())
}

fn parse_line(stream_id: &str, line: &str) -> Option<LogEntry> {
    let v: Value = serde_json::from_str(line).ok()?;
    let text = |key: &str| field_text(v.get(key)?);
    Some(LogEntry {
        stream_id: stream_id.to_string(),
        timestamp_ms: text("__REALTIME_TIMESTAMP")
            .and_then(|t| t.parse::<u64>().ok())
            .map(|us| us / 1000),
        priority: text("PRIORITY").and_then(|p| p.parse().ok()).unwrap_or(6),
        identifier: text("SYSLOG_IDENTIFIER"),
        pid: text("_PID"),
        message: text("MESSAGE").unwrap_or_default(),
    })
}

/// journald encodes non-UTF-8 fields as byte arrays in JSON output.
fn field_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Array(bytes) => {
            let raw: Vec<u8> = bytes
                .iter()
                .filter_map(|b| b.as_u64().map(|b| b as u8))
                .collect();
            Some(String::from_utf8_lossy(&raw).into_owned())
        }
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_journal_json() {
        let line = r#"{"__REALTIME_TIMESTAMP":"1700000000123456","PRIORITY":"3","SYSLOG_IDENTIFIER":"sshd","_PID":"42","MESSAGE":"boom"}"#;
        let e = parse_line("s1", line).unwrap();
        assert_eq!(e.timestamp_ms, Some(1_700_000_000_123));
        assert_eq!(e.priority, 3);
        assert_eq!(e.identifier.as_deref(), Some("sshd"));
        assert_eq!(e.message, "boom");
    }

    #[test]
    fn decodes_byte_array_messages() {
        let e = parse_line("s1", r#"{"MESSAGE":[104,105]}"#).unwrap();
        assert_eq!(e.message, "hi");
        assert_eq!(e.priority, 6);
    }
}
