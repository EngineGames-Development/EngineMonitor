//! Windows fast path for interface counters.
//!
//! `sysinfo`'s `Networks::refresh` calls `GetIfTable2` and then
//! `GetAdaptersAddresses` twice (IP addresses, then MAC addresses) on every
//! refresh. Measured on the development machine, those address lookups were
//! almost all of the ~27 ms the network refresh took per tick. Counters, state,
//! MTU, link speed and MAC address are all in the `GetIfTable2` rows, so this
//! module reads only that table every tick; IP addresses are refreshed rarely by
//! `NetworkSource` (see `source.rs`).
//!
//! All `unsafe` code of the network module lives in `read_table`.

use std::collections::HashMap;

use windows::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIfTable2, MIB_IF_ROW2, MIB_IF_TABLE2,
};
use windows::Win32::NetworkManagement::Ndis::{
    IfOperStatusDown, IfOperStatusLowerLayerDown, IfOperStatusNotPresent, IfOperStatusUp,
    MediaConnectStateDisconnected,
};

use super::LinkState;

/// The fields of one `MIB_IF_ROW2` that the monitor uses, copied out of the
/// OS-owned table.
#[derive(Debug, Clone, PartialEq)]
pub struct TableRow {
    pub alias: String,
    /// `InterfaceGuid` without `data1`; rows sharing it are filter/virtual
    /// layers of one adapter (same rule as `sysinfo`).
    pub group: (u16, u16, [u8; 8]),
    pub connected: bool,
    pub physical_address_len: u32,
    pub mac: [u8; 6],
    pub state: LinkState,
    pub mtu: u64,
    pub transmit_link_speed: u64,
    pub receive_link_speed: u64,
    pub in_octets: u64,
    pub out_octets: u64,
}

/// Keeps the same interfaces `sysinfo` lists, so switching the counter
/// source does not change which interfaces the app shows: rows with a link
/// speed, a connected medium and a hardware address, whose GUID group has
/// exactly one such row. Duplicate aliases keep the last row (as `sysinfo`'s
/// map insert does).
pub fn select(rows: Vec<TableRow>) -> Vec<TableRow> {
    let candidates: Vec<TableRow> = rows
        .into_iter()
        .filter(|r| {
            (r.transmit_link_speed != 0 || r.receive_link_speed != 0)
                && r.connected
                && r.physical_address_len != 0
        })
        .collect();
    let mut groups: HashMap<(u16, u16, [u8; 8]), usize> = HashMap::new();
    for r in &candidates {
        *groups.entry(r.group).or_default() += 1;
    }
    let mut by_alias: Vec<TableRow> = Vec::with_capacity(candidates.len());
    for r in candidates.into_iter().filter(|r| groups[&r.group] == 1) {
        match by_alias.iter_mut().find(|x| x.alias == r.alias) {
            Some(existing) => *existing = r,
            None => by_alias.push(r),
        }
    }
    by_alias
}

fn wide_to_string(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

fn to_row(r: &MIB_IF_ROW2) -> TableRow {
    let state = if r.OperStatus == IfOperStatusUp {
        LinkState::Up
    } else if r.OperStatus == IfOperStatusDown
        || r.OperStatus == IfOperStatusNotPresent
        || r.OperStatus == IfOperStatusLowerLayerDown
    {
        LinkState::Down
    } else {
        LinkState::Unknown
    };
    let mut mac = [0u8; 6];
    if r.PhysicalAddressLength == 6 {
        mac.copy_from_slice(&r.PhysicalAddress[..6]);
    }
    TableRow {
        alias: wide_to_string(&r.Alias),
        group: (
            r.InterfaceGuid.data2,
            r.InterfaceGuid.data3,
            r.InterfaceGuid.data4,
        ),
        connected: r.MediaConnectState != MediaConnectStateDisconnected,
        physical_address_len: r.PhysicalAddressLength,
        mac,
        state,
        mtu: u64::from(r.Mtu),
        transmit_link_speed: r.TransmitLinkSpeed,
        receive_link_speed: r.ReceiveLinkSpeed,
        in_octets: r.InOctets,
        out_octets: r.OutOctets,
    }
}

/// Frees the table on every exit path.
struct TableGuard(*mut MIB_IF_TABLE2);

impl Drop for TableGuard {
    fn drop(&mut self) {
        // SAFETY: the pointer was returned by a successful `GetIfTable2` and is
        // freed exactly once, here.
        unsafe { FreeMibTable(self.0 as *const core::ffi::c_void) }
    }
}

/// Reads all interface rows with one `GetIfTable2` call.
pub fn read_table() -> Result<Vec<TableRow>, String> {
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    // SAFETY: `table` is a valid out-pointer; on success the OS allocates the
    // table and stores its address there.
    unsafe { GetIfTable2(&mut table) }
        .ok()
        .map_err(|e| format!("GetIfTable2 failed: {e}"))?;
    if table.is_null() {
        return Err("GetIfTable2 returned no table".into());
    }
    let guard = TableGuard(table);
    // SAFETY: on success the table holds `NumEntries` contiguous rows starting
    // at `Table` (a C flexible array member). The slice is only used while
    // `guard` keeps the allocation alive, and rows are copied out by `to_row`.
    let rows = unsafe {
        let t = &*guard.0;
        std::slice::from_raw_parts(t.Table.as_ptr(), t.NumEntries as usize)
    };
    Ok(rows.iter().map(to_row).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(alias: &str, group: u16) -> TableRow {
        TableRow {
            alias: alias.into(),
            group: (group, 0, [0; 8]),
            connected: true,
            physical_address_len: 6,
            mac: [1, 2, 3, 4, 5, 6],
            state: LinkState::Up,
            mtu: 1500,
            transmit_link_speed: 1_000_000_000,
            receive_link_speed: 1_000_000_000,
            in_octets: 1,
            out_octets: 1,
        }
    }

    fn aliases(rows: &[TableRow]) -> Vec<&str> {
        rows.iter().map(|r| r.alias.as_str()).collect()
    }

    #[test]
    fn keeps_connected_hardware_interfaces() {
        let no_speed = TableRow {
            transmit_link_speed: 0,
            receive_link_speed: 0,
            ..row("no-speed", 2)
        };
        let disconnected = TableRow {
            connected: false,
            ..row("disconnected", 3)
        };
        let no_mac = TableRow {
            physical_address_len: 0,
            ..row("loopback", 4)
        };
        let kept = select(vec![row("Ethernet", 1), no_speed, disconnected, no_mac]);
        assert_eq!(aliases(&kept), ["Ethernet"]);
    }

    #[test]
    fn drops_every_row_of_a_shared_guid_group() {
        let kept = select(vec![
            row("Wi-Fi", 1),
            row("Wi-Fi-Filter-0000", 1),
            row("Ethernet", 2),
        ]);
        assert_eq!(aliases(&kept), ["Ethernet"]);
    }

    #[test]
    fn duplicate_alias_keeps_the_last_row() {
        let later = TableRow {
            in_octets: 99,
            ..row("Ethernet", 2)
        };
        let kept = select(vec![row("Ethernet", 1), later]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].in_octets, 99);
    }

    #[test]
    fn decodes_nul_terminated_aliases() {
        let mut w = [0u16; 8];
        for (i, c) in "Wi-Fi".encode_utf16().enumerate() {
            w[i] = c;
        }
        assert_eq!(wide_to_string(&w), "Wi-Fi");
        assert_eq!(wide_to_string(&[0x57, 0x69]), "Wi");
    }

    #[test]
    fn reads_this_machines_table() {
        // Real OS call: must succeed without administrator rights.
        let rows = read_table().expect("GetIfTable2");
        assert!(!rows.is_empty(), "every Windows machine has a loopback row");
    }
}
