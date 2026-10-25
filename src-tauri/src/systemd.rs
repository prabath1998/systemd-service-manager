//! systemd access over D-Bus (`org.freedesktop.systemd1`) via zbus.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use futures_util::future::join_all;
use tokio::sync::OnceCell;
use zbus::proxy::CacheProperties;
use zbus::zvariant::OwnedObjectPath;
use zbus::{proxy, Connection};

use crate::models::{SystemdUnit, TimerInfo};

/// (name, description, load, active, sub, following, path, job id, job type, job path)
type UnitTuple = (
    String,
    String,
    String,
    String,
    String,
    String,
    OwnedObjectPath,
    u32,
    String,
    OwnedObjectPath,
);

#[proxy(
    interface = "org.freedesktop.systemd1.Manager",
    default_service = "org.freedesktop.systemd1",
    default_path = "/org/freedesktop/systemd1"
)]
trait Manager {
    fn list_units(&self) -> zbus::Result<Vec<UnitTuple>>;
    fn list_unit_files(&self) -> zbus::Result<Vec<(String, String)>>;
    fn start_unit(&self, name: &str, mode: &str) -> zbus::Result<OwnedObjectPath>;
    fn stop_unit(&self, name: &str, mode: &str) -> zbus::Result<OwnedObjectPath>;
    fn restart_unit(&self, name: &str, mode: &str) -> zbus::Result<OwnedObjectPath>;
    fn enable_unit_files(
        &self,
        files: &[&str],
        runtime: bool,
        force: bool,
    ) -> zbus::Result<(bool, Vec<(String, String, String)>)>;
    fn disable_unit_files(
        &self,
        files: &[&str],
        runtime: bool,
    ) -> zbus::Result<Vec<(String, String, String)>>;
    fn reload(&self) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.freedesktop.systemd1.Timer",
    default_service = "org.freedesktop.systemd1"
)]
trait Timer {
    #[zbus(property, name = "Unit")]
    fn unit(&self) -> zbus::Result<String>;
    #[zbus(property, name = "NextElapseUSecRealtime")]
    fn next_elapse_usec_realtime(&self) -> zbus::Result<u64>;
    #[zbus(property, name = "LastTriggerUSec")]
    fn last_trigger_usec(&self) -> zbus::Result<u64>;
    #[zbus(property, name = "TimersCalendar")]
    fn timers_calendar(&self) -> zbus::Result<Vec<(String, String, u64)>>;
    #[zbus(property, name = "TimersMonotonic")]
    fn timers_monotonic(&self) -> zbus::Result<Vec<(String, u64, u64)>>;
}

#[proxy(
    interface = "org.freedesktop.systemd1.Service",
    default_service = "org.freedesktop.systemd1"
)]
trait Service {
    #[zbus(property, name = "MemoryCurrent")]
    fn memory_current(&self) -> zbus::Result<u64>;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scope {
    System,
    User,
}

impl Scope {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "system" => Ok(Scope::System),
            "user" => Ok(Scope::User),
            other => Err(format!("Unknown scope '{other}'")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Scope::System => "system",
            Scope::User => "user",
        }
    }
}

/// Lazily-opened, shared bus connections (managed as Tauri state).
#[derive(Default)]
pub struct Buses {
    system: OnceCell<Connection>,
    session: OnceCell<Connection>,
}

impl Buses {
    pub async fn get(&self, scope: Scope) -> Result<&Connection, String> {
        match scope {
            Scope::System => self.system.get_or_try_init(Connection::system).await,
            Scope::User => self.session.get_or_try_init(Connection::session).await,
        }
        .map_err(|e| format!("Cannot connect to the {} bus: {e}", scope.as_str()))
    }
}

async fn manager(conn: &Connection) -> Result<ManagerProxy<'_>, String> {
    ManagerProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .build()
        .await
        .map_err(err)
}

fn err(e: zbus::Error) -> String {
    match e {
        zbus::Error::MethodError(name, Some(msg), _) => format!("{msg} ({name})"),
        other => other.to_string(),
    }
}

fn unit_type(name: &str) -> String {
    name.rsplit_once('.').map(|(_, t)| t.to_string()).unwrap_or_default()
}

/// systemd reports "unset" for u64 properties as u64::MAX, and "never" as 0.
fn usec_to_ms(v: u64) -> Option<u64> {
    (v != 0 && v != u64::MAX).then_some(v / 1000)
}

pub async fn list_units(conn: &Connection, scope: Scope) -> Result<Vec<SystemdUnit>, String> {
    let mgr = manager(conn).await?;
    let (loaded, files) = tokio::join!(mgr.list_units(), mgr.list_unit_files());
    let loaded = loaded.map_err(err)?;
    let file_states: HashMap<String, String> = files
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(path, state)| {
            let name = Path::new(&path).file_name()?.to_str()?.to_string();
            Some((name, state))
        })
        .collect();

    // Memory is only meaningful for running services; fetch those concurrently.
    let memory = join_all(
        loaded
            .iter()
            .filter(|u| u.0.ends_with(".service") && u.3 == "active")
            .map(|u| async move {
                let proxy = ServiceProxy::builder(conn)
                    .path(u.6.clone())
                    .ok()?
                    .cache_properties(CacheProperties::No)
                    .build()
                    .await
                    .ok()?;
                let bytes = proxy.memory_current().await.ok()?;
                (bytes != u64::MAX).then(|| (u.0.clone(), bytes))
            }),
    )
    .await
    .into_iter()
    .flatten()
    .collect::<HashMap<_, _>>();

    let mut seen = HashSet::new();
    let mut units: Vec<SystemdUnit> = loaded
        .into_iter()
        .map(|u| {
            seen.insert(u.0.clone());
            SystemdUnit {
                unit_type: unit_type(&u.0),
                memory_bytes: memory.get(&u.0).copied(),
                unit_file_state: file_states.get(&u.0).cloned(),
                name: u.0,
                description: u.1,
                load_state: u.2,
                active_state: u.3,
                sub_state: u.4,
                scope: scope.as_str().into(),
            }
        })
        .collect();

    // ListUnits omits installed-but-unloaded units (e.g. disabled services); add those
    // services/timers so they can be started or enabled. Templates (foo@.service) are skipped.
    for (name, state) in file_states {
        let t = unit_type(&name);
        if (t == "service" || t == "timer") && !name.contains("@.") && !seen.contains(&name) {
            units.push(SystemdUnit {
                unit_type: t,
                description: String::new(),
                load_state: "not-loaded".into(),
                active_state: "inactive".into(),
                sub_state: "dead".into(),
                scope: scope.as_str().into(),
                memory_bytes: None,
                unit_file_state: Some(state),
                name,
            });
        }
    }
    units.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(units)
}

pub async fn count_failed(conn: &Connection) -> Result<usize, String> {
    let units = manager(conn).await?.list_units().await.map_err(err)?;
    Ok(units.iter().filter(|u| u.3 == "failed").count())
}

pub async fn list_timers(conn: &Connection, scope: Scope) -> Result<Vec<TimerInfo>, String> {
    let units = manager(conn).await?.list_units().await.map_err(err)?;
    let timers = join_all(
        units
            .into_iter()
            .filter(|u| u.0.ends_with(".timer"))
            .map(|u| async move {
                let p = TimerProxy::builder(conn)
                    .path(u.6.clone())
                    .ok()?
                    .cache_properties(CacheProperties::No)
                    .build()
                    .await
                    .ok()?;
                let (unit, next, last, cal, mono) = tokio::join!(
                    p.unit(),
                    p.next_elapse_usec_realtime(),
                    p.last_trigger_usec(),
                    p.timers_calendar(),
                    p.timers_monotonic()
                );
                Some(TimerInfo {
                    name: u.0,
                    scope: scope.as_str().into(),
                    description: u.1,
                    active_state: u.3,
                    unit: unit.unwrap_or_default(),
                    next_elapse_ms: next.ok().and_then(usec_to_ms),
                    last_trigger_ms: last.ok().and_then(usec_to_ms),
                    on_calendar: cal
                        .unwrap_or_default()
                        .into_iter()
                        .map(|(_, spec, _)| spec)
                        .collect(),
                    monotonic: mono
                        .unwrap_or_default()
                        .into_iter()
                        .map(|(base, usec, _)| format!("{base}={}", fmt_span(usec)))
                        .collect(),
                })
            }),
    )
    .await;
    let mut timers: Vec<TimerInfo> = timers.into_iter().flatten().collect();
    timers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(timers)
}

/// Formats a microsecond span roughly the way systemd does ("1h 30min").
fn fmt_span(usec: u64) -> String {
    let mut s = usec / 1_000_000;
    if s == 0 {
        return format!("{}ms", usec / 1000);
    }
    let mut out = Vec::new();
    for (unit, secs) in [("d", 86_400), ("h", 3_600), ("min", 60), ("s", 1)] {
        if s >= secs {
            out.push(format!("{}{unit}", s / secs));
            s %= secs;
        }
    }
    out.join(" ")
}

/// Controls a unit on the session bus (user scope).
pub async fn control_user(conn: &Connection, unit: &str, action: &str) -> Result<(), String> {
    let mgr = manager(conn).await?;
    match action {
        "start" => mgr.start_unit(unit, "replace").await.map(drop),
        "stop" => mgr.stop_unit(unit, "replace").await.map(drop),
        "restart" => mgr.restart_unit(unit, "replace").await.map(drop),
        "enable" => mgr.enable_unit_files(&[unit], false, false).await.map(drop),
        "disable" => mgr.disable_unit_files(&[unit], false).await.map(drop),
        other => return Err(format!("Unsupported action '{other}'")),
    }
    .map_err(err)?;
    if matches!(action, "enable" | "disable") {
        mgr.reload().await.map_err(err)?;
    }
    Ok(())
}

/// Controls a system unit through `pkexec systemctl` so polkit shows its auth dialog.
pub async fn control_system(unit: &str, action: &str) -> Result<(), String> {
    let out = tokio::process::Command::new("pkexec")
        .args(["systemctl", action, "--", unit])
        .output()
        .await
        .map_err(|e| format!("Failed to run pkexec: {e}"))?;
    match out.status.code() {
        Some(0) => Ok(()),
        Some(126) => Err("Authentication was cancelled.".into()),
        Some(127) => Err("Not authorized to manage system units.".into()),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

pub async fn reload(conn: &Connection) -> Result<(), String> {
    manager(conn).await?.reload().await.map_err(err)
}

pub async fn enable_and_start(conn: &Connection, unit: &str) -> Result<(), String> {
    let mgr = manager(conn).await?;
    mgr.enable_unit_files(&[unit], false, false)
        .await
        .map_err(err)?;
    mgr.reload().await.map_err(err)?;
    mgr.start_unit(unit, "replace").await.map_err(err)?;
    Ok(())
}

/// Accepts only characters systemd allows in unit names, and never a leading '-'.
pub fn validate_unit_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ":-_.\\@".contains(c));
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid unit name '{name}'"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_name_validation() {
        assert!(validate_unit_name("ssh.service").is_ok());
        assert!(validate_unit_name("getty@tty1.service").is_ok());
        assert!(validate_unit_name("--now").is_err());
        assert!(validate_unit_name("a b.service").is_err());
        assert!(validate_unit_name("../x.service").is_err());
    }

    /// Talks to the real system and session managers: `cargo test -- --ignored live`.
    #[tokio::test]
    #[ignore]
    async fn live_listing() {
        let buses = Buses::default();
        for scope in [Scope::System, Scope::User] {
            let conn = buses.get(scope).await.unwrap();
            let units = list_units(conn, scope).await.unwrap();
            let timers = list_timers(conn, scope).await.unwrap();
            let with_mem = units.iter().filter(|u| u.memory_bytes.is_some()).count();
            println!("{scope:?}: {} units ({with_mem} with memory), {} timers", units.len(), timers.len());
            assert!(!units.is_empty());
            if let Some(t) = timers.iter().find(|t| !t.on_calendar.is_empty()) {
                println!("  e.g. {} -> {} next={:?} cal={:?}", t.name, t.unit, t.next_elapse_ms, t.on_calendar);
            }
        }
    }
}
