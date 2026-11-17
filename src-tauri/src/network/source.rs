//! Reads raw interface data from the OS each tick.
//!
//! Everywhere, `sysinfo::Networks` supplies the interface list and IP
//! addresses. On Windows, counters, state, MTU, link speed and MAC come from
//! one `GetIfTable2` call per tick (`windows_table.rs`), and `sysinfo` is only
//! refreshed when the interface set changes or every `ADDRESS_REFRESH`, because
//! its refresh also looks up addresses, which costs far more than the counters.
//! Consequence: a changed IP address on an existing interface can take up to
//! `ADDRESS_REFRESH` to appear. Counters and rates are never delayed.

#[cfg(windows)]
use std::time::Duration;
use std::time::Instant;

use sysinfo::Networks;

use super::RawInterface;

/// How often IP addresses are re-read on Windows when no interface appeared
/// or disappeared.
#[cfg(windows)]
pub const ADDRESS_REFRESH: Duration = Duration::from_secs(30);

pub struct NetworkSource {
    networks: Networks,
    #[cfg(windows)]
    addresses_read_at: Instant,
    #[cfg(windows)]
    table_failed: bool,
}

/// Converts `sysinfo`'s view (after a refresh) into raw interfaces.
pub fn raw_from_sysinfo(networks: &Networks) -> Vec<RawInterface> {
    networks
        .iter()
        .map(|(name, data)| RawInterface {
            name: name.to_string_lossy().into_owned(),
            state: data.operational_state().into(),
            mac: data.mac_address().0,
            addresses: data
                .ip_networks()
                .iter()
                .map(|n| (n.addr, n.prefix))
                .collect(),
            mtu: data.mtu(),
            link_speed_bps: data.receive_link_speed(),
            total_received: data.total_received(),
            total_transmitted: data.total_transmitted(),
        })
        .collect()
}

impl NetworkSource {
    pub fn new() -> Result<Self, sysinfo::Error> {
        Ok(Self {
            networks: Networks::new_with_refreshed_list()?,
            #[cfg(windows)]
            addresses_read_at: Instant::now(),
            #[cfg(windows)]
            table_failed: false,
        })
    }

    /// Current interfaces. Never fails: if the Windows table cannot be read,
    /// this falls back to a full `sysinfo` refresh for that tick.
    pub fn read(&mut self, now: Instant) -> Vec<RawInterface> {
        #[cfg(windows)]
        match super::windows_table::read_table() {
            Ok(rows) => {
                self.table_failed = false;
                return self.read_with_table(super::windows_table::select(rows), now);
            }
            Err(e) => {
                if !self.table_failed {
                    eprintln!("EngineMonitor: {e}; using sysinfo for network counters");
                    self.table_failed = true;
                }
            }
        }
        let _ = now;
        self.networks.refresh(true);
        raw_from_sysinfo(&self.networks)
    }

    #[cfg(windows)]
    fn read_with_table(
        &mut self,
        rows: Vec<super::windows_table::TableRow>,
        now: Instant,
    ) -> Vec<RawInterface> {
        use std::ffi::OsStr;

        let known: &std::collections::HashMap<_, _> = &self.networks;
        let set_changed = rows.len() != known.len()
            || rows
                .iter()
                .any(|r| !known.contains_key(OsStr::new(&r.alias)));
        if set_changed || now.duration_since(self.addresses_read_at) >= ADDRESS_REFRESH {
            self.networks.refresh(true);
            self.addresses_read_at = now;
        }
        let known: &std::collections::HashMap<_, _> = &self.networks;
        rows.into_iter()
            .map(|r| RawInterface {
                addresses: known
                    .get(OsStr::new(&r.alias))
                    .map(|d| d.ip_networks().iter().map(|n| (n.addr, n.prefix)).collect())
                    .unwrap_or_default(),
                name: r.alias,
                state: r.state,
                mac: r.mac,
                mtu: r.mtu,
                link_speed_bps: Some(r.receive_link_speed).filter(|&s| s != 0),
                total_received: r.in_octets,
                total_transmitted: r.out_octets,
            })
            .collect()
    }
}
