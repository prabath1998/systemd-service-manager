// Mirrors the structs in src-tauri/src/models.rs.

export type Scope = "system" | "user";
export type UnitAction = "start" | "stop" | "restart" | "enable" | "disable";

export interface SystemdUnit {
  name: string;
  description: string;
  load_state: string;
  active_state: string;
  sub_state: string;
  unit_type: string;
  scope: Scope;
  memory_bytes: number | null;
  unit_file_state: string | null;
}

export interface TimerInfo {
  name: string;
  scope: Scope;
  description: string;
  active_state: string;
  unit: string;
  next_elapse_ms: number | null;
  last_trigger_ms: number | null;
  on_calendar: string[];
  monotonic: string[];
}

export interface LogEntry {
  stream_id: string;
  timestamp_ms: number | null;
  priority: number;
  identifier: string | null;
  pid: string | null;
  message: string;
}

export interface TimerRequest {
  cron: string;
  unit_name: string;
  exec_path: string;
  description?: string;
}

export interface GeneratedTimer {
  service_name: string;
  timer_name: string;
  service_content: string;
  timer_content: string;
  on_calendar: string[];
  next_runs: string[];
}
