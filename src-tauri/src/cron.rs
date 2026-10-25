//! Converts 5-field cron expressions into systemd `OnCalendar=` expressions.

use std::collections::BTreeSet;

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];
const CRON_DAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/// systemd weekday names, indexed Monday = 1 .. Sunday = 7.
const SYSTEMD_DAYS: [&str; 8] = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

#[derive(Debug, PartialEq)]
pub enum Trigger {
    Calendar(Vec<String>),
    /// `@reboot`, which maps to `OnBootSec=` rather than a calendar event.
    Boot,
}

struct Field {
    values: BTreeSet<u32>,
    /// Cron treats a day field beginning with `*` as unrestricted when combining dom/dow.
    starred: bool,
}

pub fn parse(expr: &str) -> Result<Trigger, String> {
    let expr = expr.trim();
    let expanded = match expr.to_ascii_lowercase().as_str() {
        "@reboot" => return Ok(Trigger::Boot),
        "@yearly" | "@annually" => "0 0 1 1 *".to_string(),
        "@monthly" => "0 0 1 * *".to_string(),
        "@weekly" => "0 0 * * 0".to_string(),
        "@daily" | "@midnight" => "0 0 * * *".to_string(),
        "@hourly" => "0 * * * *".to_string(),
        s if s.starts_with('@') => return Err(format!("Unknown cron macro '{expr}'")),
        _ => expr.to_string(),
    };

    let parts: Vec<&str> = expanded.split_whitespace().collect();
    if parts.len() != 5 {
        return Err(format!(
            "Expected 5 fields (minute hour day-of-month month day-of-week), got {}",
            parts.len()
        ));
    }

    let minute = parse_field(parts[0], 0, 59, &[], "minute")?;
    let hour = parse_field(parts[1], 0, 23, &[], "hour")?;
    let dom = parse_field(parts[2], 1, 31, &[], "day-of-month")?;
    let month = parse_field(parts[3], 1, 12, &MONTHS, "month")?;
    let mut dow = parse_field(parts[4], 0, 7, &CRON_DAYS, "day-of-week")?;
    // Cron allows both 0 and 7 for Sunday; normalise to systemd's Mon=1..Sun=7.
    if dow.values.remove(&0) {
        dow.values.insert(7);
    }

    let hh = fmt_numeric(&hour.values, 0, 23);
    let mm = fmt_numeric(&minute.values, 0, 59);
    let dd = fmt_numeric(&dom.values, 1, 31);
    let mo = fmt_numeric(&month.values, 1, 12);
    let wd = fmt_weekdays(&dow.values);

    let clock = format!("{hh}:{mm}:00");
    let dom_restricted = !dom.starred;
    let dow_restricted = !dow.starred;

    let lines = if dom_restricted && dow_restricted {
        // Cron fires when *either* day field matches; systemd ANDs them, so emit two events.
        vec![
            format!("*-{mo}-{dd} {clock}"),
            format!("{} *-{mo}-* {clock}", wd.unwrap_or_default()),
        ]
    } else if dow_restricted {
        match wd {
            Some(wd) => vec![format!("{wd} *-{mo}-{dd} {clock}")],
            None => vec![format!("*-{mo}-{dd} {clock}")],
        }
    } else {
        vec![format!("*-{mo}-{dd} {clock}")]
    };
    Ok(Trigger::Calendar(lines))
}

fn parse_field(
    raw: &str,
    min: u32,
    max: u32,
    names: &[&str],
    label: &str,
) -> Result<Field, String> {
    let mut values = BTreeSet::new();
    for item in raw.split(',') {
        let (range, step) = match item.split_once('/') {
            Some((r, s)) => {
                let step: u32 = s
                    .parse()
                    .map_err(|_| format!("Invalid step '{s}' in {label} field"))?;
                if step == 0 {
                    return Err(format!("Step cannot be 0 in {label} field"));
                }
                (r, step)
            }
            None => (item, 1),
        };
        let (lo, hi) = if range == "*" {
            (min, max)
        } else if let Some((a, b)) = range.split_once('-') {
            (value(a, min, names, label)?, value(b, min, names, label)?)
        } else {
            let v = value(range, min, names, label)?;
            // "a/n" means "from a to the end, every n".
            (v, if step > 1 { max } else { v })
        };
        if lo < min || hi > max || lo > hi {
            return Err(format!(
                "'{item}' is out of range for {label} ({min}-{max})"
            ));
        }
        values.extend((lo..=hi).step_by(step as usize));
    }
    Ok(Field {
        values,
        starred: raw.starts_with('*'),
    })
}

fn value(raw: &str, min: u32, names: &[&str], label: &str) -> Result<u32, String> {
    if let Some(i) = names.iter().position(|n| raw.eq_ignore_ascii_case(n)) {
        // Month names are 1-based, weekday names are 0-based (sun = 0).
        return Ok(i as u32 + if min == 1 { 1 } else { 0 });
    }
    raw.parse()
        .map_err(|_| format!("Invalid value '{raw}' in {label} field"))
}

/// Formats a numeric field as `*`, `start/step`, or a list with `a..b` runs.
fn fmt_numeric(values: &BTreeSet<u32>, min: u32, max: u32) -> String {
    let n = |v: u32| format!("{v:02}");
    let v: Vec<u32> = values.iter().copied().collect();
    if v.len() as u32 == max - min + 1 {
        return "*".into();
    }
    if v.len() >= 3 {
        let step = v[1] - v[0];
        let progression = v.windows(2).all(|w| w[1] - w[0] == step);
        // A progression that runs to the end of the range is systemd's "start/step".
        if step > 1 && progression && v[v.len() - 1] + step > max {
            return format!("{}/{}", n(v[0]), step);
        }
    }
    join_runs(&v, n)
}

fn fmt_weekdays(values: &BTreeSet<u32>) -> Option<String> {
    let v: Vec<u32> = values.iter().copied().collect();
    if v.len() == 7 {
        return None;
    }
    Some(join_runs(&v, |d| SYSTEMD_DAYS[d as usize].to_string()))
}

/// Joins sorted values, collapsing runs of 3+ consecutive values into `a..b`.
fn join_runs(v: &[u32], fmt: impl Fn(u32) -> String) -> String {
    let mut out = Vec::new();
    let mut i = 0;
    while i < v.len() {
        let mut j = i;
        while j + 1 < v.len() && v[j + 1] == v[j] + 1 {
            j += 1;
        }
        if j - i >= 2 {
            out.push(format!("{}..{}", fmt(v[i]), fmt(v[j])));
        } else {
            out.extend(v[i..=j].iter().map(|&x| fmt(x)));
        }
        i = j + 1;
    }
    out.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cal(expr: &str) -> Vec<String> {
        match parse(expr).unwrap() {
            Trigger::Calendar(c) => c,
            Trigger::Boot => panic!("unexpected boot trigger"),
        }
    }

    #[test]
    fn daily_at_two() {
        assert_eq!(cal("0 2 * * *"), ["*-*-* 02:00:00"]);
    }

    #[test]
    fn every_fifteen_minutes() {
        assert_eq!(cal("*/15 * * * *"), ["*-*-* *:00/15:00"]);
    }

    #[test]
    fn weekdays_range_and_names() {
        assert_eq!(cal("30 9 * * mon-fri"), ["Mon..Fri *-*-* 09:30:00"]);
        assert_eq!(cal("0 0 * * 0"), ["Sun *-*-* 00:00:00"]);
        assert_eq!(cal("0 0 * * 6,7"), ["Sat,Sun *-*-* 00:00:00"]);
    }

    #[test]
    fn lists_and_months() {
        assert_eq!(cal("5,10 8-18 1 jan,jul *"), ["*-01,07-01 08..18:05,10:00"]);
    }

    #[test]
    fn dom_and_dow_are_ored() {
        assert_eq!(
            cal("0 12 1 * mon"),
            ["*-*-01 12:00:00", "Mon *-*-* 12:00:00"]
        );
    }

    #[test]
    fn range_with_step_is_expanded() {
        assert_eq!(cal("0 1-10/3 * * *"), ["*-*-* 01,04,07,10:00:00"]);
    }

    #[test]
    fn macros() {
        assert_eq!(cal("@hourly"), ["*-*-* *:00:00"]);
        assert_eq!(cal("@monthly"), ["*-*-01 00:00:00"]);
        assert_eq!(parse("@reboot").unwrap(), Trigger::Boot);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse("60 * * * *").is_err());
        assert!(parse("* * *").is_err());
        assert!(parse("*/0 * * * *").is_err());
        assert!(parse("@sometimes").is_err());
    }
}
