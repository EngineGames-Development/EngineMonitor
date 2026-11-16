//! GPU monitoring behind a provider abstraction.
//!
//! GPU data is vendor- and platform-specific, so collection goes through
//! [`GpuProvider`] implementations. `GpuMonitor` isolates them from the rest
//! of the sampler: a provider that fails to initialise, returns an error or
//! panics turns into an explicit `Reading::Error`/`Unsupported` for the GPU
//! section only; CPU, memory, storage and network sampling continue.
//!
//! Providers (one per platform, chosen at compile time):
//! * Windows: `windows_provider::WindowsGpuProvider` — DXGI adapters plus PDH
//!   "GPU Engine" / "GPU Adapter Memory" counters, Task-Manager semantics.
//!   Verified against Windows' own counters on the dev machine.
//! * Linux/macOS: `sysinfo_provider::SysinfoGpuProvider` — `sysinfo`'s GPU
//!   support. Not verified on real hardware. (On Windows `sysinfo` summed all
//!   engines and read 0 bytes of VRAM, which is why it is not used there.)
//! * Neither exposes temperature. NVML (NVIDIA) is planned but not
//!   implemented: it cannot be verified without NVIDIA hardware.

#[cfg(not(windows))]
pub mod sysinfo_provider;
#[cfg(windows)]
pub mod windows_provider;

use std::panic::{catch_unwind, AssertUnwindSafe};

use serde::Serialize;

use crate::reading::Reading;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSample {
    /// Stable identifier within a run (PCI address where available).
    pub id: String,
    pub model: Option<String>,
    pub vendor: Option<String>,
    /// Which provider produced this sample, e.g. "sysinfo".
    pub provider: &'static str,
    pub usage_percent: Reading<f32>,
    /// Dedicated VRAM only (shared system memory is not included).
    pub memory_total_bytes: Reading<u64>,
    pub memory_used_bytes: Reading<u64>,
    pub memory_usage_percent: Option<f64>,
    pub temperature_celsius: Reading<f32>,
}

/// Providers may hold thread-affine OS handles, so they are not required to
/// be `Send`; the sampler creates and uses them on its own thread only.
pub trait GpuProvider {
    fn name(&self) -> &'static str;
    /// Refreshes and returns all adapters this provider can see.
    fn sample(&mut self) -> Result<Vec<GpuSample>, String>;
}

/// Owns the active provider and contains its failures.
pub struct GpuMonitor {
    provider: Result<Box<dyn GpuProvider>, Reading<Vec<GpuSample>>>,
}

impl GpuMonitor {
    /// Picks the first provider that initialises.
    pub fn new() -> Self {
        #[cfg(windows)]
        let init = catch_unwind(windows_provider::WindowsGpuProvider::new);
        #[cfg(not(windows))]
        let init = catch_unwind(sysinfo_provider::SysinfoGpuProvider::new);
        let provider = match init {
            Ok(Ok(p)) => Ok(Box::new(p) as Box<dyn GpuProvider>),
            Ok(Err(reading)) => Err(reading),
            Err(_) => Err(Reading::error(
                "the GPU provider panicked during initialisation",
            )),
        };
        Self { provider }
    }

    pub fn with_provider(provider: Box<dyn GpuProvider>) -> Self {
        Self {
            provider: Ok(provider),
        }
    }

    pub fn sample(&mut self) -> Reading<Vec<GpuSample>> {
        let provider = match &mut self.provider {
            Ok(p) => p,
            Err(reading) => return reading.clone(),
        };
        let name = provider.name();
        match catch_unwind(AssertUnwindSafe(|| provider.sample())) {
            Ok(Ok(gpus)) => Reading::ok(gpus),
            Ok(Err(message)) => Reading::error(message),
            Err(_) => {
                // A panicking provider is disabled for the rest of the run.
                let reading = Reading::error(format!(
                    "the {name} GPU provider crashed and has been disabled"
                ));
                self.provider = Err(reading.clone());
                reading
            }
        }
    }
}

impl Default for GpuMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Panicking;
    impl GpuProvider for Panicking {
        fn name(&self) -> &'static str {
            "test"
        }
        fn sample(&mut self) -> Result<Vec<GpuSample>, String> {
            panic!("driver exploded")
        }
    }

    struct Failing;
    impl GpuProvider for Failing {
        fn name(&self) -> &'static str {
            "test"
        }
        fn sample(&mut self) -> Result<Vec<GpuSample>, String> {
            Err("query failed".into())
        }
    }

    #[test]
    fn provider_panic_is_contained_and_disables_provider() {
        let mut m = GpuMonitor::with_provider(Box::new(Panicking));
        let r = m.sample();
        assert!(matches!(&r, Reading::Error { message } if message.contains("disabled")));
        // Subsequent calls return the same error without calling the provider.
        assert_eq!(m.sample(), r);
    }

    #[test]
    fn provider_error_is_reported_per_tick() {
        let mut m = GpuMonitor::with_provider(Box::new(Failing));
        assert_eq!(m.sample(), Reading::error("query failed"));
    }

    #[test]
    fn real_provider_never_panics_and_reports_some_state() {
        let mut m = GpuMonitor::new();
        // Whatever the hardware, the result is a well-formed Reading.
        let _ = m.sample();
        let _ = m.sample();
    }
}
