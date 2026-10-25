# Systemd Dashboard

A Tauri v2 desktop app for Ubuntu that lets you inspect, control and schedule systemd services and timers, for both the system manager and your user manager.

- **Units view**: a sortable table of services (or any unit type) showing active state, sub-state, memory, enabled state, and Start/Stop/Restart/Logs actions.
- **Timers view**: next run, last trigger and `OnCalendar` schedule for every `.timer`.
- **Live journal drawer**: tails `journalctl -f -o json`, with pause/resume, clear, severity filters (ERROR/WARN/INFO) and auto-scroll.
- **Cron → timer generator**: converts a cron expression into a `.service` + `.timer` pair, previews the next runs with `systemd-analyze`, then writes the files to `~/.config/systemd/user/`, reloads the user manager, and enables and starts the timer.
- **Tray icon**: turns red while any system or user unit is `failed`. Closing the window hides it to the tray; use **Quit** from the tray menu to exit.
- **Theme**: follows the GTK/Yaru light or dark setting, with a manual override in the sidebar.

## How it talks to systemd

| Operation | Mechanism |
|---|---|
| List units / timers, memory, unit-file state | `zbus` → `org.freedesktop.systemd1.Manager` on the system and session buses |
| Control **user** units | D-Bus `StartUnit` / `StopUnit` / `RestartUnit` / `EnableUnitFiles` / `DisableUnitFiles` + `Reload` |
| Control **system** units | `pkexec systemctl <action> -- <unit>`, so polkit shows its authentication dialog |
| Logs | `journalctl [--user] -f -n 100 -o json -u <unit>`, streamed as `journal-log-line` events |

## Prerequisites (Ubuntu)

```sh
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

You also need Rust (stable), Node.js 20+ and pnpm.

## Development

```sh
pnpm install
pnpm tauri dev
```

Tests (cron conversion, unit file generation, journal JSON parsing):

```sh
cd src-tauri && cargo test
```

## Packaging

```sh
pnpm tauri build
# → src-tauri/target/release/bundle/deb/Systemd Dashboard_0.1.0_amd64.deb
```

## Layout

```
src/                     React 19 + Tailwind v4 + shadcn/ui frontend
  components/ui/         shadcn components (button, table, tabs, dialog, sheet, …)
  components/            title bar, sidebar, units/timers tables, log sheet, generator dialog
  lib/api.ts             typed wrappers around the Tauri commands and events
src-tauri/src/
  systemd.rs             zbus proxies, listing and controlling units
  journal.rs             journalctl streaming
  cron.rs                cron → OnCalendar conversion
  timer_gen.rs           .service/.timer generation and installation
  tray.rs                tray icon and failed-unit monitor
  lib.rs                 Tauri commands and app setup
```

## Cron conversion notes

- Supports `*`, lists, ranges, steps, month and weekday names, and the macros `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly` and `@reboot`.
- When cron restricts both day-of-month and day-of-week, cron runs the job when *either* matches, but systemd requires *both*. The generator therefore emits two `OnCalendar=` lines.
- `@reboot` becomes `OnStartupSec=1min`, which fires shortly after your user session starts.
- Calendar timers get `Persistent=true`, so a run missed while the machine was off happens at the next boot.
