//! Physical memory and swap.
//!
//! "Used" is what `sysinfo` reports (total − available on Windows, the
//! kernel's accounting elsewhere). "Available" is memory that can be given to
//! applications without swapping, which is the number users care about.

use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySample {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    /// `None` only if total memory could not be determined (0).
    pub usage_percent: Option<f64>,
    /// 0 when no swap / page file is configured.
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    /// `None` when no swap is configured.
    pub swap_usage_percent: Option<f64>,
}

pub fn percent(used: u64, total: u64) -> Option<f64> {
    if total == 0 {
        return None;
    }
    Some((used.min(total) as f64 / total as f64 * 100.0).clamp(0.0, 100.0))
}

pub fn build_sample(
    total: u64,
    used: u64,
    available: u64,
    swap_total: u64,
    swap_used: u64,
) -> MemorySample {
    MemorySample {
        total_bytes: total,
        used_bytes: used.min(total),
        available_bytes: available.min(total),
        usage_percent: percent(used, total),
        swap_total_bytes: swap_total,
        swap_used_bytes: swap_used.min(swap_total),
        swap_usage_percent: percent(swap_used, swap_total),
    }
}

/// Call after `System::refresh_memory`.
pub fn sample(sys: &System) -> MemorySample {
    build_sample(
        sys.total_memory(),
        sys.used_memory(),
        sys.available_memory(),
        sys.total_swap(),
        sys.used_swap(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn computes_usage_percentages() {
        let m = build_sample(16 * GIB, 4 * GIB, 12 * GIB, 8 * GIB, 2 * GIB);
        assert_eq!(m.usage_percent, Some(25.0));
        assert_eq!(m.swap_usage_percent, Some(25.0));
    }

    #[test]
    fn no_swap_is_none_not_zero_percent() {
        let m = build_sample(16 * GIB, 4 * GIB, 12 * GIB, 0, 0);
        assert_eq!(m.swap_usage_percent, None);
        assert_eq!(m.swap_total_bytes, 0);
    }

    #[test]
    fn unknown_total_yields_no_percentage() {
        assert_eq!(build_sample(0, 0, 0, 0, 0).usage_percent, None);
    }

    #[test]
    fn inconsistent_counters_are_clamped() {
        // Counters are read at slightly different instants and can disagree.
        let m = build_sample(8 * GIB, 9 * GIB, 10 * GIB, GIB, 2 * GIB);
        assert_eq!(m.used_bytes, 8 * GIB);
        assert_eq!(m.available_bytes, 8 * GIB);
        assert_eq!(m.usage_percent, Some(100.0));
        assert_eq!(m.swap_used_bytes, GIB);
    }
}
