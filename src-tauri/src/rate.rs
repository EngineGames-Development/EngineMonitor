//! Rates from monotonically increasing counters.
//!
//! Network and disk speeds are derived from cumulative byte counters:
//! `rate = (current - previous) / elapsed`. Counters are not trustworthy in
//! every situation, so a rate is only produced when it can be computed
//! honestly:
//!
//! * the first observation of a counter has no predecessor -> no rate;
//! * a counter that decreased was reset (interface re-created, driver
//!   reloaded, 32-bit wrap) -> no rate for that tick, tracking restarts;
//! * zero or negative elapsed time -> no rate.
//!
//! "No rate" is `None`, which the UI shows as unavailable for that tick
//! instead of a fake zero or a huge spike.

use std::collections::HashMap;
use std::hash::Hash;
use std::time::Instant;

/// Tracks one cumulative counter.
#[derive(Debug, Default, Clone)]
pub struct CounterRate {
    last: Option<(u64, Instant)>,
}

impl CounterRate {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records `value` observed at `now` and returns units per second since
    /// the previous observation, if one can be computed.
    pub fn update(&mut self, value: u64, now: Instant) -> Option<f64> {
        let previous = self.last.replace((value, now));
        let (prev_value, prev_time) = previous?;
        if value < prev_value {
            return None; // counter reset
        }
        let elapsed = now.checked_duration_since(prev_time)?.as_secs_f64();
        if elapsed <= 0.0 {
            return None;
        }
        Some((value - prev_value) as f64 / elapsed)
    }
}

/// Tracks a set of keyed counters (e.g. one per interface or disk) and
/// forgets keys that disappear, so a re-appearing device starts fresh.
#[derive(Debug)]
pub struct RateMap<K> {
    counters: HashMap<K, CounterRate>,
}

impl<K> Default for RateMap<K> {
    fn default() -> Self {
        Self {
            counters: HashMap::new(),
        }
    }
}

impl<K: Eq + Hash + Clone> RateMap<K> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update(&mut self, key: &K, value: u64, now: Instant) -> Option<f64> {
        if let Some(counter) = self.counters.get_mut(key) {
            return counter.update(value, now);
        }
        let mut counter = CounterRate::new();
        let rate = counter.update(value, now);
        self.counters.insert(key.clone(), counter);
        rate
    }

    /// Drops every key for which `keep` returns false.
    pub fn retain(&mut self, mut keep: impl FnMut(&K) -> bool) {
        self.counters.retain(|k, _| keep(k));
    }

    pub fn len(&self) -> usize {
        self.counters.len()
    }

    pub fn is_empty(&self) -> bool {
        self.counters.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn first_observation_has_no_rate() {
        let mut c = CounterRate::new();
        assert_eq!(c.update(1_000, Instant::now()), None);
    }

    #[test]
    fn rate_uses_measured_elapsed_time() {
        let t0 = Instant::now();
        let mut c = CounterRate::new();
        c.update(1_000, t0);
        let r = c.update(3_000, t0 + Duration::from_millis(500)).unwrap();
        assert!(approx(r, 4_000.0), "got {r}");
        // Irregular interval: 1500 bytes over 1.5 s = 1000 B/s.
        let r = c.update(4_500, t0 + Duration::from_millis(2_000)).unwrap();
        assert!(approx(r, 1_000.0), "got {r}");
    }

    #[test]
    fn unchanged_counter_is_zero_not_none() {
        let t0 = Instant::now();
        let mut c = CounterRate::new();
        c.update(42, t0);
        assert_eq!(c.update(42, t0 + Duration::from_secs(1)), Some(0.0));
    }

    #[test]
    fn counter_reset_yields_none_then_recovers() {
        let t0 = Instant::now();
        let mut c = CounterRate::new();
        c.update(10_000, t0);
        assert_eq!(c.update(200, t0 + Duration::from_secs(1)), None);
        let r = c.update(1_200, t0 + Duration::from_secs(2)).unwrap();
        assert!(approx(r, 1_000.0));
    }

    #[test]
    fn zero_or_backwards_elapsed_yields_none() {
        let t0 = Instant::now();
        let mut c = CounterRate::new();
        c.update(0, t0 + Duration::from_secs(1));
        assert_eq!(c.update(100, t0 + Duration::from_secs(1)), None);
        assert_eq!(c.update(200, t0), None);
    }

    #[test]
    fn rate_map_tracks_keys_independently_and_forgets_removed() {
        let t0 = Instant::now();
        let t1 = t0 + Duration::from_secs(1);
        let mut m: RateMap<String> = RateMap::new();
        let eth = "eth0".to_string();
        let wlan = "wlan0".to_string();

        assert_eq!(m.update(&eth, 100, t0), None);
        assert_eq!(m.update(&wlan, 5_000, t0), None);
        assert_eq!(m.update(&eth, 300, t1), Some(200.0));
        assert_eq!(m.update(&wlan, 5_500, t1), Some(500.0));

        // wlan0 disappears; when it comes back it must not produce a rate
        // computed against the stale counter.
        m.retain(|k| k == &eth);
        assert_eq!(m.len(), 1);
        assert_eq!(m.update(&wlan, 9_000, t1 + Duration::from_secs(1)), None);
    }
}
