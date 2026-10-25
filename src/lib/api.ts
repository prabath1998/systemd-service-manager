import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  GeneratedTimer,
  LogEntry,
  Scope,
  SystemdUnit,
  TimerInfo,
  TimerRequest,
  UnitAction,
} from "./types";

export const api = {
  getUnits: (scope?: Scope) => invoke<SystemdUnit[]>("get_systemd_units", { scope }),
  getTimers: (scope: Scope) => invoke<TimerInfo[]>("get_timers", { scope }),
  controlUnit: (unitName: string, action: UnitAction, scope: Scope) =>
    invoke<void>("control_unit", { unitName, action, scope }),
  streamLogs: (streamId: string, unitName: string, scope: Scope, lines = 100) =>
    invoke<void>("stream_unit_logs", { streamId, unitName, scope, lines }),
  stopLogs: (streamId: string) => invoke<void>("stop_unit_logs", { streamId }),
  generateTimer: (request: TimerRequest) =>
    invoke<GeneratedTimer>("generate_systemd_timer", { request }),
  saveUserTimer: (request: TimerRequest, overwrite: boolean) =>
    invoke<string>("save_user_timer", { request, overwrite }),
  closeMainWindow: () => invoke<void>("close_main_window"),
};

export const onLogLine = (cb: (e: LogEntry) => void): Promise<UnlistenFn> =>
  listen<LogEntry>("journal-log-line", (ev) => cb(ev.payload));

export const onLogStreamEnded = (cb: (streamId: string) => void): Promise<UnlistenFn> =>
  listen<string>("journal-stream-ended", (ev) => cb(ev.payload));

export const onFailedCount = (cb: (count: number) => void): Promise<UnlistenFn> =>
  listen<number>("failed-units-changed", (ev) => cb(ev.payload));

export const errorMessage = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
