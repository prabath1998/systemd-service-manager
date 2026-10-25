use serde::{Deserialize, Serialize};

/// Mirrors `SystemdUnit` in `src/lib/types.ts`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemdUnit {
    pub name: String,
    pub description: String,
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub unit_type: String, // "service", "timer", "socket", etc.
    pub scope: String,     // "system" or "user"
    pub memory_bytes: Option<u64>,
    /// "enabled", "disabled", "static", ... (from ListUnitFiles), if known.
    pub unit_file_state: Option<String>,
}

/// Mirrors `TimerInfo` in `src/lib/types.ts`. Times are UNIX epoch milliseconds.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TimerInfo {
    pub name: String,
    pub scope: String,
    pub description: String,
    pub active_state: String,
    pub unit: String,
    pub next_elapse_ms: Option<u64>,
    pub last_trigger_ms: Option<u64>,
    pub on_calendar: Vec<String>,
    pub monotonic: Vec<String>,
}

/// Mirrors `LogEntry` in `src/lib/types.ts`.
#[derive(Serialize, Clone, Debug)]
pub struct LogEntry {
    pub stream_id: String,
    pub timestamp_ms: Option<u64>,
    pub priority: u8,
    pub identifier: Option<String>,
    pub pid: Option<String>,
    pub message: String,
}

/// Mirrors `GeneratedTimer` in `src/lib/types.ts`.
#[derive(Serialize, Clone, Debug)]
pub struct GeneratedTimer {
    pub service_name: String,
    pub timer_name: String,
    pub service_content: String,
    pub timer_content: String,
    pub on_calendar: Vec<String>,
    pub next_runs: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TimerRequest {
    pub cron: String,
    pub unit_name: String,
    pub exec_path: String,
    pub description: Option<String>,
}
