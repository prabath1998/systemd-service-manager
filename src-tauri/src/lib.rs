mod cron;
mod journal;
mod models;
mod systemd;
mod timer_gen;
mod tray;

use tauri::{AppHandle, State, WebviewWindow};

use models::{GeneratedTimer, SystemdUnit, TimerInfo, TimerRequest};
use systemd::{Buses, Scope};

const ACTIONS: [&str; 5] = ["start", "stop", "restart", "enable", "disable"];

/// Lists units for one scope, or both when `scope` is omitted. When listing both, a
/// scope whose bus is unreachable is skipped rather than failing the whole call.
#[tauri::command]
async fn get_systemd_units(
    buses: State<'_, Buses>,
    scope: Option<String>,
) -> Result<Vec<SystemdUnit>, String> {
    if let Some(scope) = scope {
        let scope = Scope::parse(&scope)?;
        return systemd::list_units(buses.get(scope).await?, scope).await;
    }
    let mut all = Vec::new();
    for scope in [Scope::System, Scope::User] {
        if let Ok(conn) = buses.get(scope).await {
            all.extend(systemd::list_units(conn, scope).await.unwrap_or_default());
        }
    }
    Ok(all)
}

#[tauri::command]
async fn get_timers(buses: State<'_, Buses>, scope: String) -> Result<Vec<TimerInfo>, String> {
    let scope = Scope::parse(&scope)?;
    systemd::list_timers(buses.get(scope).await?, scope).await
}

#[tauri::command]
async fn control_unit(
    buses: State<'_, Buses>,
    unit_name: String,
    action: String,
    scope: String,
) -> Result<(), String> {
    systemd::validate_unit_name(&unit_name)?;
    if !ACTIONS.contains(&action.as_str()) {
        return Err(format!("Unsupported action '{action}'"));
    }
    match Scope::parse(&scope)? {
        Scope::User => systemd::control_user(buses.get(Scope::User).await?, &unit_name, &action).await,
        Scope::System => systemd::control_system(&unit_name, &action).await,
    }
}

#[tauri::command]
fn stream_unit_logs(
    app: AppHandle,
    streams: State<'_, journal::Streams>,
    stream_id: String,
    unit_name: String,
    scope: String,
    lines: Option<u32>,
) -> Result<(), String> {
    systemd::validate_unit_name(&unit_name)?;
    let scope = Scope::parse(&scope)?;
    journal::start(app, &streams, stream_id, unit_name, scope, lines.unwrap_or(100))
}

#[tauri::command]
fn stop_unit_logs(streams: State<'_, journal::Streams>, stream_id: String) {
    streams.stop(&stream_id);
}

#[tauri::command]
async fn generate_systemd_timer(request: TimerRequest) -> Result<GeneratedTimer, String> {
    let mut generated = timer_gen::generate(&request)?;
    generated.next_runs = timer_gen::next_runs(&generated.on_calendar).await;
    Ok(generated)
}

/// Regenerates the files from the request (never trusting client-supplied unit text),
/// writes them to ~/.config/systemd/user/, daemon-reloads, and enables + starts the timer.
#[tauri::command]
async fn save_user_timer(
    buses: State<'_, Buses>,
    request: TimerRequest,
    overwrite: bool,
) -> Result<String, String> {
    let generated = timer_gen::generate(&request)?;
    timer_gen::install(buses.get(Scope::User).await?, &generated, overwrite).await
}

/// Hides to the tray when one exists so failure monitoring keeps running; otherwise quits.
#[tauri::command]
fn close_main_window(app: AppHandle, window: WebviewWindow) {
    if app.tray_by_id(tray::TRAY_ID).is_some() {
        let _ = window.hide();
    } else {
        app.exit(0);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Buses::default())
        .manage(journal::Streams::default())
        .setup(|app| {
            // The tray needs libayatana-appindicator at runtime; run without it if absent.
            if let Err(e) = tray::init(app.handle()) {
                eprintln!("System tray unavailable: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_systemd_units,
            get_timers,
            control_unit,
            stream_unit_logs,
            stop_unit_logs,
            generate_systemd_timer,
            save_user_timer,
            close_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

