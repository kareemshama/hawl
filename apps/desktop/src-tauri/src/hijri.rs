//! Hijri (Umm al-Qura) conversion through ICU4X (SPEC.md section 6, RULES.md R2.5, R2.6).
//!
//! `adjust` is the user's moonsighting offset in days: +1 means the local calendar runs one day
//! ahead of Umm al-Qura. Gregorian -> Hijri applies it by shifting the Gregorian date forward
//! before converting; Hijri -> Gregorian shifts the result back, so the two are inverses.

use icu_calendar::cal::{Hijri, Iso};
use icu_calendar::Date;
use serde::Serialize;

pub const MONTH_NAMES: [&str; 12] = [
    "Muharram",
    "Safar",
    "Rabi' al-Awwal",
    "Rabi' al-Thani",
    "Jumada al-Ula",
    "Jumada al-Akhirah",
    "Rajab",
    "Sha'ban",
    "Ramadan",
    "Shawwal",
    "Dhu al-Qa'dah",
    "Dhu al-Hijjah",
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HijriDate {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub month_name: String,
    pub label: String,
    pub gregorian: String,
}

/// Days since 1970-01-01 to (year, month, day). Howard Hinnant's civil_from_days.
pub fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    ((if m <= 2 { y + 1 } else { y }) as i32, m, d)
}

/// (year, month, day) to days since 1970-01-01. Howard Hinnant's days_from_civil.
pub fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y as i64 - 1 } else { y as i64 };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if m > 2 { m as i64 - 3 } else { m as i64 + 9 };
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn parse_iso(s: &str) -> Result<(i32, u32, u32), String> {
    let parts: Vec<&str> = s.trim().split('-').collect();
    if parts.len() != 3 {
        return Err(format!("Invalid date: {s}"));
    }
    let y = parts[0].parse::<i32>().map_err(|_| format!("Invalid year in {s}"))?;
    let m = parts[1].parse::<u32>().map_err(|_| format!("Invalid month in {s}"))?;
    let d = parts[2].parse::<u32>().map_err(|_| format!("Invalid day in {s}"))?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return Err(format!("Invalid date: {s}"));
    }
    Ok((y, m, d))
}

fn format_iso(y: i32, m: u32, d: u32) -> String {
    format!("{y:04}-{m:02}-{d:02}")
}

fn shift_iso(date: &str, days: i64) -> Result<String, String> {
    let (y, m, d) = parse_iso(date)?;
    let (ny, nm, nd) = civil_from_days(days_from_civil(y, m, d) + days);
    Ok(format_iso(ny, nm, nd))
}

/// Gregorian ISO date -> Hijri (Umm al-Qura), with moonsighting adjustment.
pub fn from_gregorian(date: &str, adjust: i32) -> Result<HijriDate, String> {
    let shifted = shift_iso(date, adjust as i64)?;
    let (y, m, d) = parse_iso(&shifted)?;
    let iso = Date::try_new_iso(y, m as u8, d as u8).map_err(|e| format!("Invalid Gregorian date {date}: {e:?}"))?;
    let h = iso.to_calendar(Hijri::new_umm_al_qura());
    let year = h.era_year().year;
    let month = h.month().ordinal;
    let day = h.day_of_month().0;
    Ok(HijriDate {
        year,
        month,
        day,
        month_name: MONTH_NAMES[(month as usize - 1).min(11)].to_string(),
        label: format!("{} {} {}", day, MONTH_NAMES[(month as usize - 1).min(11)], year),
        gregorian: date.to_string(),
    })
}

/// Hijri (Umm al-Qura) -> Gregorian ISO date, with moonsighting adjustment.
/// A day that does not exist in a 29-day month is clamped to the 29th.
pub fn to_gregorian(year: i32, month: u8, day: u8, adjust: i32) -> Result<HijriDate, String> {
    if !(1..=12).contains(&month) || !(1..=30).contains(&day) {
        return Err("Hijri month must be 1 to 12 and day 1 to 30.".into());
    }
    let cal = Hijri::new_umm_al_qura();
    let h = match Date::try_new_hijri_with_calendar(year, month, day, cal) {
        Ok(h) => h,
        Err(_) if day == 30 => Date::try_new_hijri_with_calendar(year, month, 29, cal)
            .map_err(|e| format!("Invalid Hijri date {year}-{month}-{day}: {e:?}"))?,
        Err(e) => return Err(format!("Invalid Hijri date {year}-{month}-{day}: {e:?}")),
    };
    let iso = h.to_calendar(Iso);
    let g = format_iso(iso.year().extended_year(), iso.month().ordinal as u32, iso.day_of_month().0 as u32);
    let gregorian = shift_iso(&g, -(adjust as i64))?;
    let actual_day = h.day_of_month().0;
    Ok(HijriDate {
        year,
        month,
        day: actual_day,
        month_name: MONTH_NAMES[month as usize - 1].to_string(),
        label: format!("{} {} {}", actual_day, MONTH_NAMES[month as usize - 1], year),
        gregorian,
    })
}

/// The first occurrence of a Hijri month/day on or after `from` (Gregorian), searching this
/// Hijri year and the next two.
pub fn next_occurrence(month: u8, day: u8, from: &str, adjust: i32) -> Result<HijriDate, String> {
    let current = from_gregorian(from, adjust)?;
    for year in current.year..=current.year + 2 {
        let candidate = to_gregorian(year, month, day, adjust)?;
        if candidate.gregorian.as_str() >= from {
            return Ok(candidate);
        }
    }
    Err("Could not find the next anniversary.".into())
}

/// The most recent occurrence of a Hijri month/day on or before `from` (Gregorian).
pub fn previous_occurrence(month: u8, day: u8, from: &str, adjust: i32) -> Result<HijriDate, String> {
    let current = from_gregorian(from, adjust)?;
    for year in (current.year - 2..=current.year).rev() {
        let candidate = to_gregorian(year, month, day, adjust)?;
        if candidate.gregorian.as_str() <= from {
            return Ok(candidate);
        }
    }
    Err("Could not find the previous anniversary.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_roundtrip() {
        for days in [-1_000_000i64, -1, 0, 1, 19_000, 20_694, 100_000] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn known_dates() {
        // 1 Ramadan 1446 AH was 1 March 2025 in the Umm al-Qura calendar.
        let h = from_gregorian("2025-03-01", 0).unwrap();
        assert_eq!((h.year, h.month, h.day), (1446, 9, 1));
        let g = to_gregorian(1446, 9, 1, 0).unwrap();
        assert_eq!(g.gregorian, "2025-03-01");
    }

    #[test]
    fn adjustment_is_inverse() {
        for adjust in [-1, 0, 1] {
            let h = from_gregorian("2026-03-01", adjust).unwrap();
            let g = to_gregorian(h.year, h.month, h.day, adjust).unwrap();
            assert_eq!(g.gregorian, "2026-03-01", "adjust {adjust}");
        }
    }

    #[test]
    fn next_and_previous() {
        let n = next_occurrence(9, 1, "2025-06-01", 0).unwrap();
        assert!(n.gregorian.as_str() > "2025-06-01");
        assert_eq!(n.year, 1447);
        let p = previous_occurrence(9, 1, "2025-06-01", 0).unwrap();
        assert_eq!(p.gregorian, "2025-03-01");
    }
}
