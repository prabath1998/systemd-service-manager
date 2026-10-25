//! AppIndicator tray icon that turns red while any system or user unit is `failed`.

use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

use crate::systemd::{self, Buses, Scope};

pub const TRAY_ID: &str = "main";
pub const FAILED_EVENT: &str = "failed-units-changed";
const POLL_INTERVAL: Duration = Duration::from_secs(10);

const OK_COLOR: [u8; 3] = [0xE9, 0x54, 0x20]; // Ubuntu orange
const FAILED_COLOR: [u8; 3] = [0xC7, 0x16, 0x2B]; // Yaru red

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon(false))
        .tooltip("Systemd Dashboard")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    let handle = app.clone();
    tauri::async_runtime::spawn(async move { monitor(handle).await });
    Ok(())
}

async fn monitor(app: AppHandle) {
    let mut last: Option<usize> = None;
    loop {
        let buses = app.state::<Buses>();
        let mut failed = 0;
        for scope in [Scope::System, Scope::User] {
            if let Ok(conn) = buses.get(scope).await {
                failed += systemd::count_failed(conn).await.unwrap_or(0);
            }
        }
        if last != Some(failed) {
            last = Some(failed);
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_icon(Some(icon(failed > 0)));
                let tip = match failed {
                    0 => "Systemd Dashboard — all units healthy".to_string(),
                    1 => "Systemd Dashboard — 1 failed unit".to_string(),
                    n => format!("Systemd Dashboard — {n} failed units"),
                };
                let _ = tray.set_tooltip(Some(tip));
            }
            let _ = app.emit(FAILED_EVENT, failed);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Draws a 32×32 status disc: a filled circle with a white ring (plus a "!" when failed).
fn icon(failed: bool) -> Image<'static> {
    const N: usize = 32;
    let [r, g, b] = if failed { FAILED_COLOR } else { OK_COLOR };
    let mut px = vec![0u8; N * N * 4];
    let c = (N as f32 - 1.0) / 2.0;
    for y in 0..N {
        for x in 0..N {
            let d = ((x as f32 - c).powi(2) + (y as f32 - c).powi(2)).sqrt();
            let alpha = (15.5 - d).clamp(0.0, 1.0); // anti-aliased edge
            let ring = (8.0..10.5).contains(&d);
            let bang = failed && (14..=17).contains(&x) && ((8..=18).contains(&y) || (21..=23).contains(&y));
            let rgb = if bang || (ring && !failed) { [255, 255, 255] } else { [r, g, b] };
            let i = (y * N + x) * 4;
            px[i..i + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], (alpha * 255.0) as u8]);
        }
    }
    Image::new_owned(px, N as u32, N as u32)
}
