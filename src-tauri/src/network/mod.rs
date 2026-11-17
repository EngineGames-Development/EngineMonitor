//! Network interfaces and traffic.
//!
//! Speeds come from cumulative byte counters divided by measured elapsed time
//! (see `rate.rs`), so irregular sampling and counter resets are handled. The
//! aggregate speed excludes loopback interfaces, which would otherwise count
//! local traffic as network traffic.

mod source;
#[cfg(windows)]
mod windows_table;

pub use source::{raw_from_sysinfo, NetworkSource};

use std::collections::HashSet;
use std::net::IpAddr;
use std::time::Instant;

use serde::Serialize;
use sysinfo::InterfaceOperationalState;

use crate::rate::RateMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkState {
    Up,
    Down,
    Unknown,
}

impl From<InterfaceOperationalState> for LinkState {
    fn from(s: InterfaceOperationalState) -> Self {
        match s {
            InterfaceOperationalState::Up => LinkState::Up,
            InterfaceOperationalState::Down
            | InterfaceOperationalState::NotPresent
            | InterfaceOperationalState::LowerLayerDown => LinkState::Down,
            _ => LinkState::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceSample {
    pub name: String,
    pub state: LinkState,
    pub loopback: bool,
    /// `None` if the OS reports no hardware address (all zeros).
    pub mac_address: Option<String>,
    /// CIDR notation, e.g. "192.168.1.20/24".
    pub addresses: Vec<String>,
    pub mtu: Option<u64>,
    /// Negotiated link speed in bits/s, when the driver reports it.
    pub link_speed_bps: Option<u64>,
    pub total_received_bytes: u64,
    pub total_transmitted_bytes: u64,
    /// `None` on the first tick and after a counter reset.
    pub receive_bytes_per_sec: Option<f64>,
    pub transmit_bytes_per_sec: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSample {
    /// Sum over non-loopback interfaces that have a rate this tick; `None`
    /// if none do (e.g. first tick).
    pub receive_bytes_per_sec: Option<f64>,
    pub transmit_bytes_per_sec: Option<f64>,
    pub interfaces: Vec<InterfaceSample>,
}

#[derive(Debug, Clone)]
pub struct RawInterface {
    pub name: String,
    pub state: LinkState,
    pub mac: [u8; 6],
    pub addresses: Vec<(IpAddr, u8)>,
    pub mtu: u64,
    pub link_speed_bps: Option<u64>,
    pub total_received: u64,
    pub total_transmitted: u64,
}

fn format_mac(mac: [u8; 6]) -> Option<String> {
    if mac == [0; 6] {
        return None;
    }
    Some(
        mac.iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

fn is_loopback(name: &str, addresses: &[(IpAddr, u8)]) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower == "lo" || lower.starts_with("loopback") || lower.contains("loopback pseudo") {
        return true;
    }
    !addresses.is_empty() && addresses.iter().all(|(a, _)| a.is_loopback())
}

fn sum_rates(rates: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    rates
        .flatten()
        .fold(None, |acc, r| Some(acc.unwrap_or(0.0) + r))
}

#[derive(Debug, Default)]
pub struct NetworkCollector {
    rx: RateMap<String>,
    tx: RateMap<String>,
}

impl NetworkCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn build(&mut self, raw: Vec<RawInterface>, now: Instant) -> NetworkSample {
        let mut seen = HashSet::with_capacity(raw.len());
        let mut interfaces: Vec<InterfaceSample> = raw
            .into_iter()
            .map(|mut r| {
                seen.insert(r.name.clone());
                // The OS (and sysinfo's set) give no stable order; IPv4 first.
                r.addresses.sort();
                let loopback = is_loopback(&r.name, &r.addresses);
                InterfaceSample {
                    receive_bytes_per_sec: self.rx.update(&r.name, r.total_received, now),
                    transmit_bytes_per_sec: self.tx.update(&r.name, r.total_transmitted, now),
                    mac_address: format_mac(r.mac),
                    addresses: r
                        .addresses
                        .iter()
                        .map(|(a, p)| format!("{a}/{p}"))
                        .collect(),
                    mtu: (r.mtu > 0).then_some(r.mtu),
                    link_speed_bps: r.link_speed_bps.filter(|&s| s > 0),
                    total_received_bytes: r.total_received,
                    total_transmitted_bytes: r.total_transmitted,
                    state: r.state,
                    loopback,
                    name: r.name,
                }
            })
            .collect();

        // Interfaces that vanished (adapter disabled, VPN closed) are forgotten.
        self.rx.retain(|k| seen.contains(k));
        self.tx.retain(|k| seen.contains(k));

        // Up first, then busiest, then by name for stable ordering.
        interfaces.sort_by(|a, b| {
            (a.state != LinkState::Up)
                .cmp(&(b.state != LinkState::Up))
                .then(a.loopback.cmp(&b.loopback))
                .then(
                    (b.total_received_bytes + b.total_transmitted_bytes)
                        .cmp(&(a.total_received_bytes + a.total_transmitted_bytes)),
                )
                .then(a.name.cmp(&b.name))
        });

        let external = || interfaces.iter().filter(|i| !i.loopback);
        NetworkSample {
            receive_bytes_per_sec: sum_rates(external().map(|i| i.receive_bytes_per_sec)),
            transmit_bytes_per_sec: sum_rates(external().map(|i| i.transmit_bytes_per_sec)),
            interfaces,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use std::time::Duration;

    fn iface(name: &str, rx: u64, tx: u64) -> RawInterface {
        RawInterface {
            name: name.into(),
            state: LinkState::Up,
            mac: [0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e],
            addresses: vec![(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)), 24)],
            mtu: 1500,
            link_speed_bps: Some(1_000_000_000),
            total_received: rx,
            total_transmitted: tx,
        }
    }

    fn lo(rx: u64) -> RawInterface {
        RawInterface {
            addresses: vec![(IpAddr::V4(Ipv4Addr::LOCALHOST), 8)],
            mac: [0; 6],
            ..iface("lo", rx, rx)
        }
    }

    #[test]
    fn first_tick_has_no_rates() {
        let mut c = NetworkCollector::new();
        let s = c.build(vec![iface("eth0", 100, 100)], Instant::now());
        assert_eq!(s.receive_bytes_per_sec, None);
        assert_eq!(s.interfaces[0].receive_bytes_per_sec, None);
    }

    #[test]
    fn aggregate_excludes_loopback() {
        let t0 = Instant::now();
        let t1 = t0 + Duration::from_secs(1);
        let mut c = NetworkCollector::new();
        c.build(vec![iface("eth0", 0, 0), iface("wlan0", 0, 0), lo(0)], t0);
        let s = c.build(
            vec![
                iface("eth0", 1_000, 100),
                iface("wlan0", 500, 50),
                lo(1_000_000),
            ],
            t1,
        );
        assert_eq!(s.receive_bytes_per_sec, Some(1_500.0));
        assert_eq!(s.transmit_bytes_per_sec, Some(150.0));
        let l = s.interfaces.iter().find(|i| i.name == "lo").unwrap();
        assert!(l.loopback);
        assert_eq!(l.mac_address, None);
    }

    #[test]
    fn counter_reset_on_one_interface_does_not_corrupt_total() {
        let t0 = Instant::now();
        let t1 = t0 + Duration::from_secs(1);
        let mut c = NetworkCollector::new();
        c.build(vec![iface("eth0", 10_000, 0), iface("wlan0", 0, 0)], t0);
        let s = c.build(vec![iface("eth0", 5, 0), iface("wlan0", 300, 0)], t1);
        let eth = s.interfaces.iter().find(|i| i.name == "eth0").unwrap();
        assert_eq!(eth.receive_bytes_per_sec, None);
        assert_eq!(s.receive_bytes_per_sec, Some(300.0));
    }

    #[test]
    fn interface_disappearing_and_returning_starts_fresh() {
        let t0 = Instant::now();
        let mut c = NetworkCollector::new();
        c.build(vec![iface("vpn0", 100, 100)], t0);
        c.build(vec![], t0 + Duration::from_secs(1));
        let s = c.build(
            vec![iface("vpn0", 9_000, 9_000)],
            t0 + Duration::from_secs(2),
        );
        assert_eq!(s.interfaces[0].receive_bytes_per_sec, None);
    }

    #[test]
    fn formats_interface_details() {
        let mut c = NetworkCollector::new();
        let s = c.build(vec![iface("eth0", 1, 1)], Instant::now());
        let i = &s.interfaces[0];
        assert_eq!(i.mac_address.as_deref(), Some("00:1a:2b:3c:4d:5e"));
        assert_eq!(i.addresses, vec!["192.168.1.20/24".to_string()]);
        assert_eq!(i.mtu, Some(1500));
    }

    #[test]
    fn addresses_are_sorted_ipv4_first() {
        let mut c = NetworkCollector::new();
        let raw = RawInterface {
            addresses: vec![
                ("fe80::1".parse().unwrap(), 64),
                ("10.0.0.2".parse().unwrap(), 8),
                ("2001:db8::1".parse().unwrap(), 64),
            ],
            ..iface("eth0", 1, 1)
        };
        let s = c.build(vec![raw], Instant::now());
        assert_eq!(
            s.interfaces[0].addresses,
            ["10.0.0.2/8", "2001:db8::1/64", "fe80::1/64"]
        );
    }

    #[test]
    fn sorts_up_interfaces_first_then_by_traffic() {
        let mut c = NetworkCollector::new();
        let down = RawInterface {
            state: LinkState::Down,
            ..iface("down0", 1_000_000, 0)
        };
        let s = c.build(
            vec![down, iface("small", 10, 0), iface("big", 1_000, 0)],
            Instant::now(),
        );
        let names: Vec<_> = s.interfaces.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["big", "small", "down0"]);
    }
}
