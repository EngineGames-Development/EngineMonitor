//! Windows GPU provider: DXGI for adapters, PDH for utilisation and memory.
//!
//! * Adapters (name, vendor, dedicated VRAM, LUID) come from DXGI. Software
//!   adapters ("Microsoft Basic Render Driver") are skipped.
//! * Utilisation comes from the `\GPU Engine(*)\Utilization Percentage`
//!   counters. Instances are per process and engine; following Task
//!   Manager, an adapter's utilisation is the busiest *engine type* (sum over
//!   processes per type, then the maximum over types), not the sum of all
//!   engines (which double-counts e.g. 3D and video decode).
//! * Dedicated memory in use comes from `\GPU Adapter Memory(*)\Dedicated Usage`.
//! * Counters are matched to adapters by LUID, which appears in the counter
//!   instance names (`…luid_0x00000000_0x00017A3A_phys_0…`).
//! * Counters are added with their English names, so this works on localised
//!   Windows installations.
//! * Temperature is not available through these APIs.

use std::collections::HashMap;

use windows::core::PCWSTR;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
};

use super::{GpuProvider, GpuSample};
use crate::memory::percent;
use crate::reading::Reading;

const ENGINE_COUNTER: &str = r"\GPU Engine(*)\Utilization Percentage";
const MEMORY_COUNTER: &str = r"\GPU Adapter Memory(*)\Dedicated Usage";
const NO_TEMPERATURE: &str =
    "GPU temperature is not exposed by Windows' generic GPU counters; it needs a vendor-specific provider";
/// Adapters rarely change; re-enumerate occasionally to pick up hot-plug/driver changes.
const ADAPTER_REFRESH_TICKS: u32 = 60;

/// LUID packed as (HighPart << 32) | LowPart, matching the counter names.
pub type LuidKey = u64;

pub fn luid_key(high: i32, low: u32) -> LuidKey {
    ((high as u32 as u64) << 32) | low as u64
}

/// Extracts the LUID from a counter instance name.
pub fn parse_luid(instance: &str) -> Option<LuidKey> {
    let rest = &instance[instance.find("luid_0x")? + "luid_0x".len()..];
    let mut parts = rest.split('_');
    let high = u32::from_str_radix(parts.next()?, 16).ok()?;
    let low = u32::from_str_radix(parts.next()?.strip_prefix("0x")?, 16).ok()?;
    Some(((high as u64) << 32) | low as u64)
}

/// Extracts the engine type ("3D", "VideoDecode", "Copy", …) from a GPU Engine instance name.
pub fn parse_engine_type(instance: &str) -> Option<&str> {
    let t = &instance[instance.find("engtype_")? + "engtype_".len()..];
    (!t.is_empty()).then_some(t)
}

/// Per adapter: max over engine types of the summed utilisation of that type.
pub fn aggregate_utilisation<'a>(
    items: impl IntoIterator<Item = (&'a str, f64)>,
) -> HashMap<LuidKey, f32> {
    let mut per_type: HashMap<(LuidKey, &'a str), f64> = HashMap::new();
    for (name, value) in items {
        if !value.is_finite() || value < 0.0 {
            continue;
        }
        if let (Some(luid), Some(engine)) = (parse_luid(name), parse_engine_type(name)) {
            *per_type.entry((luid, engine)).or_default() += value;
        }
    }
    let mut out: HashMap<LuidKey, f32> = HashMap::new();
    for ((luid, _), sum) in per_type {
        let v = sum.clamp(0.0, 100.0) as f32;
        let e = out.entry(luid).or_insert(0.0);
        if v > *e {
            *e = v;
        }
    }
    out
}

/// Per adapter: summed dedicated memory usage in bytes.
pub fn aggregate_memory<'a>(
    items: impl IntoIterator<Item = (&'a str, f64)>,
) -> HashMap<LuidKey, u64> {
    let mut out = HashMap::new();
    for (name, value) in items {
        if value.is_finite() && value >= 0.0 {
            if let Some(luid) = parse_luid(name) {
                *out.entry(luid).or_default() += value as u64;
            }
        }
    }
    out
}

pub fn vendor_name(vendor_id: u32) -> Option<&'static str> {
    match vendor_id {
        0x1002 | 0x1022 => Some("AMD"),
        0x10DE => Some("NVIDIA"),
        0x8086 => Some("Intel"),
        0x5143 => Some("Qualcomm"),
        0x1414 => Some("Microsoft"),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct Adapter {
    pub luid: LuidKey,
    pub description: String,
    pub vendor_id: u32,
    pub dedicated_bytes: u64,
}

/// Combines adapters with counter data. Pure; unit-tested.
pub fn build_samples(
    adapters: &[Adapter],
    utilisation: Option<&HashMap<LuidKey, f32>>,
    memory: Option<&HashMap<LuidKey, u64>>,
    primed: bool,
) -> Vec<GpuSample> {
    adapters
        .iter()
        .map(|a| {
            let usage_percent = match utilisation {
                None if !primed => Reading::Pending,
                None => Reading::error("the GPU Engine performance counters could not be read"),
                Some(map) => match map.get(&a.luid) {
                    Some(&v) => Reading::ok(v),
                    // An adapter with no active engine instances is idle when
                    // other adapters do report: report 0 only if the counter
                    // set itself works (map is non-empty).
                    None if !map.is_empty() => Reading::ok(0.0),
                    None => Reading::unsupported("no GPU engine counters for this adapter"),
                },
            };
            let total = (a.dedicated_bytes > 0).then_some(a.dedicated_bytes);
            let used = memory.and_then(|m| m.get(&a.luid).copied());
            let (memory_total_bytes, memory_used_bytes, memory_usage_percent) = match (total, used)
            {
                (Some(t), Some(u)) => (Reading::ok(t), Reading::ok(u.min(t)), percent(u, t)),
                (Some(t), None) => (
                    Reading::ok(t),
                    Reading::unsupported("dedicated memory usage is not reported for this adapter"),
                    None,
                ),
                (None, _) => (
                    Reading::unsupported("this adapter has no dedicated video memory"),
                    Reading::unsupported("this adapter has no dedicated video memory"),
                    None,
                ),
            };
            GpuSample {
                id: format!("luid:{:016x}", a.luid),
                model: Some(a.description.clone()).filter(|d| !d.is_empty()),
                vendor: vendor_name(a.vendor_id).map(str::to_owned),
                provider: "windows-pdh",
                usage_percent,
                memory_total_bytes,
                memory_used_bytes,
                memory_usage_percent,
                temperature_celsius: Reading::unsupported(NO_TEMPERATURE),
            }
        })
        .collect()
}

fn enumerate_adapters() -> Result<Vec<Adapter>, String> {
    // SAFETY: DXGI factory creation and adapter enumeration are plain COM
    // calls; all returned interfaces are reference-counted smart pointers.
    unsafe {
        let factory: IDXGIFactory1 =
            CreateDXGIFactory1().map_err(|e| format!("DXGI unavailable: {}", e.message()))?;
        let mut adapters = Vec::new();
        let mut index = 0;
        while let Ok(adapter) = factory.EnumAdapters1(index) {
            index += 1;
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            let len = desc
                .Description
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(desc.Description.len());
            adapters.push(Adapter {
                luid: luid_key(desc.AdapterLuid.HighPart, desc.AdapterLuid.LowPart),
                description: String::from_utf16_lossy(&desc.Description[..len])
                    .trim()
                    .to_owned(),
                vendor_id: desc.VendorId,
                dedicated_bytes: desc.DedicatedVideoMemory as u64,
            });
        }
        Ok(adapters)
    }
}

/// Owned PDH query, closed on drop.
struct Query {
    handle: PDH_HQUERY,
    engine: Option<PDH_HCOUNTER>,
    memory: Option<PDH_HCOUNTER>,
}

impl Query {
    fn open() -> Option<Self> {
        let mut handle = PDH_HQUERY::default();
        // SAFETY: out-pointer to a local; handle is closed in Drop.
        if unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut handle) } != ERROR_SUCCESS.0 {
            return None;
        }
        let mut q = Self {
            handle,
            engine: None,
            memory: None,
        };
        q.engine = q.add(ENGINE_COUNTER);
        q.memory = q.add(MEMORY_COUNTER);
        Some(q)
    }

    fn add(&self, path: &str) -> Option<PDH_HCOUNTER> {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut counter = PDH_HCOUNTER::default();
        // SAFETY: `wide` is NUL-terminated and outlives the call; the counter
        // belongs to `self.handle` and is freed with it.
        let status = unsafe {
            PdhAddEnglishCounterW(
                self.handle,
                PCWSTR::from_raw(wide.as_ptr()),
                0,
                &mut counter,
            )
        };
        (status == ERROR_SUCCESS.0 && !counter.is_invalid()).then_some(counter)
    }

    fn collect(&self) -> bool {
        // SAFETY: valid query handle owned by self.
        unsafe { PdhCollectQueryData(self.handle) == ERROR_SUCCESS.0 }
    }

    /// Reads all instances of a wildcard counter as (instance name, value).
    fn read(counter: PDH_HCOUNTER) -> Option<Vec<(String, f64)>> {
        let mut size = 0u32;
        let mut count = 0u32;
        // SAFETY: first call only queries the required buffer size.
        unsafe {
            PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
        }
        if size == 0 {
            return None;
        }
        // u64 storage guarantees the 8-byte alignment the item structs need.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let items_ptr = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        // SAFETY: buffer is at least `size` bytes and suitably aligned.
        let status = unsafe {
            PdhGetFormattedCounterArrayW(
                counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                Some(items_ptr),
            )
        };
        if status != ERROR_SUCCESS.0 {
            return None;
        }
        // SAFETY: PDH wrote `count` items at the start of `buffer`; their name
        // pointers point into the same buffer, which outlives this loop.
        let items = unsafe { std::slice::from_raw_parts(items_ptr, count as usize) };
        Some(
            items
                .iter()
                .map(|item| unsafe {
                    let name = PCWSTR(item.szName.0).to_string().unwrap_or_default();
                    (name, item.FmtValue.Anonymous.doubleValue)
                })
                .collect(),
        )
    }
}

impl Drop for Query {
    fn drop(&mut self) {
        // SAFETY: closes the query we opened (and its counters) exactly once.
        unsafe {
            PdhCloseQuery(self.handle);
        }
    }
}

pub struct WindowsGpuProvider {
    query: Option<Query>,
    adapters: Vec<Adapter>,
    ticks: u32,
}

impl WindowsGpuProvider {
    pub fn new() -> Result<Self, Reading<Vec<GpuSample>>> {
        let adapters = enumerate_adapters().map_err(Reading::error)?;
        let query = Query::open();
        if let Some(q) = &query {
            q.collect(); // baseline for the rate counter
        }
        Ok(Self {
            query,
            adapters,
            ticks: 0,
        })
    }
}

impl GpuProvider for WindowsGpuProvider {
    fn name(&self) -> &'static str {
        "windows-pdh"
    }

    fn sample(&mut self) -> Result<Vec<GpuSample>, String> {
        self.ticks = self.ticks.wrapping_add(1);
        if self.ticks % ADAPTER_REFRESH_TICKS == 0 {
            if let Ok(adapters) = enumerate_adapters() {
                self.adapters = adapters;
            }
        }
        let primed = self.ticks >= 2;
        let (utilisation, memory) = match &self.query {
            Some(q) if q.collect() => (
                q.engine.and_then(Query::read).map(|items| {
                    aggregate_utilisation(items.iter().map(|(n, v)| (n.as_str(), *v)))
                }),
                q.memory
                    .and_then(Query::read)
                    .map(|items| aggregate_memory(items.iter().map(|(n, v)| (n.as_str(), *v)))),
            ),
            _ => (None, None),
        };
        Ok(build_samples(
            &self.adapters,
            utilisation.as_ref(),
            memory.as_ref(),
            primed,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Instance-name formats as reported on the development machine.
    const ENG_3D_A: &str = "pid_1234_luid_0x00000000_0x00017A3A_phys_0_eng_0_engtype_3D";
    const ENG_3D_B: &str = "pid_5678_luid_0x00000000_0x00017A3A_phys_0_eng_0_engtype_3D";
    const ENG_VIDEO: &str =
        "pid_5678_luid_0x00000000_0x00017A3A_phys_0_eng_4_engtype_Video Codec 0";
    const ENG_OTHER: &str = "pid_42_luid_0x00000001_0x0001884B_phys_0_eng_0_engtype_Copy";
    const MEM: &str = "luid_0x00000000_0x00017A3A_phys_0";

    #[test]
    fn parses_luid_and_engine_type() {
        assert_eq!(parse_luid(ENG_3D_A), Some(0x0001_7A3A));
        assert_eq!(parse_luid(ENG_OTHER), Some((1u64 << 32) | 0x0001_884B));
        assert_eq!(parse_luid(MEM), Some(0x0001_7A3A));
        assert_eq!(parse_luid("garbage"), None);
        assert_eq!(parse_engine_type(ENG_VIDEO), Some("Video Codec 0"));
        assert_eq!(parse_engine_type(MEM), None);
        assert_eq!(luid_key(0, 0x0001_7A3A), 0x0001_7A3A);
    }

    #[test]
    fn utilisation_is_busiest_engine_type_not_sum_of_all() {
        // Matches the dev machine: 3D 49 % (two processes), video 43 %.
        // sysinfo reported 92 % (sum); Task Manager semantics give 49 %.
        let u = aggregate_utilisation([
            (ENG_3D_A, 40.0),
            (ENG_3D_B, 9.0),
            (ENG_VIDEO, 43.0),
            (ENG_OTHER, 5.0),
        ]);
        assert_eq!(u[&0x0001_7A3A], 49.0);
        assert_eq!(u[&((1u64 << 32) | 0x0001_884B)], 5.0);
    }

    #[test]
    fn utilisation_ignores_bad_values_and_clamps() {
        let u = aggregate_utilisation([(ENG_3D_A, 80.0), (ENG_3D_B, 70.0), (ENG_VIDEO, f64::NAN)]);
        assert_eq!(u[&0x0001_7A3A], 100.0);
    }

    #[test]
    fn memory_sums_per_adapter() {
        let m = aggregate_memory([
            (MEM, 1_046_945_792.0),
            ("luid_0x00000000_0x00017A3A_phys_1", 1.0),
        ]);
        assert_eq!(m[&0x0001_7A3A], 1_046_945_793);
    }

    fn adapter() -> Adapter {
        Adapter {
            luid: 0x0001_7A3A,
            description: "AMD Radeon(TM) Vega 8 Graphics".into(),
            vendor_id: 0x1002,
            dedicated_bytes: 2_131_324_928,
        }
    }

    #[test]
    fn builds_samples_by_luid() {
        let u = HashMap::from([(0x0001_7A3A, 49.0)]);
        let m = HashMap::from([(0x0001_7A3A, 1_046_945_792)]);
        let s = &build_samples(&[adapter()], Some(&u), Some(&m), true)[0];
        assert_eq!(s.vendor.as_deref(), Some("AMD"));
        assert_eq!(s.usage_percent, Reading::ok(49.0));
        assert_eq!(s.memory_used_bytes, Reading::ok(1_046_945_792));
        assert!((s.memory_usage_percent.unwrap() - 49.12).abs() < 0.01);
        assert!(matches!(s.temperature_celsius, Reading::Unsupported { .. }));
    }

    #[test]
    fn adapter_without_engine_instances_is_idle_if_counters_work() {
        let u = HashMap::from([(999, 10.0)]);
        let s = &build_samples(&[adapter()], Some(&u), None, true)[0];
        assert_eq!(s.usage_percent, Reading::ok(0.0));
        assert!(matches!(s.memory_used_bytes, Reading::Unsupported { .. }));
    }

    #[test]
    fn missing_counters_are_pending_then_error() {
        assert_eq!(
            build_samples(&[adapter()], None, None, false)[0].usage_percent,
            Reading::Pending
        );
        assert!(matches!(
            build_samples(&[adapter()], None, None, true)[0].usage_percent,
            Reading::Error { .. }
        ));
    }

    #[test]
    fn real_adapters_enumerate_without_software_renderer() {
        let adapters = enumerate_adapters().expect("DXGI available on Windows");
        assert!(adapters
            .iter()
            .all(|a| !a.description.contains("Basic Render")));
    }
}
