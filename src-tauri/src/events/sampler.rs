//! Generic periodic sampler.
//!
//! Runs `source` on a dedicated thread every `interval`, hands each value to
//! `sink` and keeps the latest one. The wait uses a `Condvar`, so stopping or
//! changing the interval takes effect immediately rather than after the
//! current sleep. The interval is measured from the start of each tick, so a
//! slow tick does not stretch the cadence (it is never shortened below zero
//! either: an overrunning tick starts the next one right away).

use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const MIN_INTERVAL: Duration = Duration::from_millis(250);
pub const MAX_INTERVAL: Duration = Duration::from_millis(10_000);
pub const DEFAULT_INTERVAL: Duration = Duration::from_millis(1_000);

/// Clamps a requested interval to the supported range.
pub fn clamp_interval(requested: Duration) -> Duration {
    requested.clamp(MIN_INTERVAL, MAX_INTERVAL)
}

struct State<T> {
    interval: Duration,
    stop: bool,
    latest: Option<T>,
}

struct Shared<T> {
    state: Mutex<State<T>>,
    wake: Condvar,
}

impl<T> Shared<T> {
    /// A panic inside `source`/`sink` must not make the sampler unusable for
    /// other threads; the state is plain data, so recovering is safe.
    fn lock(&self) -> MutexGuard<'_, State<T>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub struct Sampler<T> {
    shared: Arc<Shared<T>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl<T: Clone + Send + 'static> Sampler<T> {
    pub fn spawn<S, F>(name: &str, interval: Duration, source: S, sink: F) -> std::io::Result<Self>
    where
        S: FnMut() -> T + Send + 'static,
        F: Fn(&T) + Send + 'static,
    {
        Self::spawn_with(name, interval, move || source, sink)
    }

    /// Like [`Sampler::spawn`], but the source is built *on the sampler
    /// thread* by `make_source`. Use this for sources holding OS handles that
    /// must not cross threads (they need not be `Send`).
    pub fn spawn_with<M, S, F>(
        name: &str,
        interval: Duration,
        make_source: M,
        sink: F,
    ) -> std::io::Result<Self>
    where
        M: FnOnce() -> S + Send + 'static,
        S: FnMut() -> T + 'static,
        F: Fn(&T) + Send + 'static,
    {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                interval: clamp_interval(interval),
                stop: false,
                latest: None,
            }),
            wake: Condvar::new(),
        });
        let worker = Arc::clone(&shared);
        let thread = std::thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                let mut source = make_source();
                loop {
                    let started = Instant::now();
                    let value = source();
                    sink(&value);

                    let mut st = worker.lock();
                    st.latest = Some(value);
                    loop {
                        if st.stop {
                            return;
                        }
                        let deadline = started + st.interval;
                        let now = Instant::now();
                        if now >= deadline {
                            break;
                        }
                        st = worker
                            .wake
                            .wait_timeout(st, deadline - now)
                            .unwrap_or_else(PoisonError::into_inner)
                            .0;
                    }
                }
            })?;
        Ok(Self {
            shared,
            thread: Mutex::new(Some(thread)),
        })
    }

    pub fn latest(&self) -> Option<T> {
        self.shared.lock().latest.clone()
    }

    pub fn interval(&self) -> Duration {
        self.shared.lock().interval
    }

    /// Applies a new interval (clamped) and returns the effective value.
    pub fn set_interval(&self, requested: Duration) -> Duration {
        let effective = clamp_interval(requested);
        self.shared.lock().interval = effective;
        self.shared.wake.notify_all();
        effective
    }
}

impl<T> Sampler<T> {
    /// Stops the thread and waits for it. Idempotent.
    pub fn stop(&self) {
        {
            let mut st = self.shared.lock();
            st.stop = true;
        }
        self.shared.wake.notify_all();
        let handle = self
            .thread
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(handle) = handle {
            if handle.join().is_err() {
                eprintln!("EngineMonitor: sampler thread panicked");
            }
        }
    }
}

impl<T> Drop for Sampler<T> {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;

    #[test]
    fn clamps_interval() {
        assert_eq!(clamp_interval(Duration::from_millis(10)), MIN_INTERVAL);
        assert_eq!(clamp_interval(Duration::from_secs(60)), MAX_INTERVAL);
        assert_eq!(
            clamp_interval(Duration::from_millis(1_500)),
            Duration::from_millis(1_500)
        );
    }

    #[test]
    fn samples_immediately_then_periodically_and_keeps_latest() {
        let counter = Arc::new(AtomicU32::new(0));
        let c = Arc::clone(&counter);
        let (tx, rx) = mpsc::channel();
        let s = Sampler::spawn(
            "test",
            MIN_INTERVAL,
            move || c.fetch_add(1, Ordering::SeqCst) + 1,
            move |v: &u32| {
                let _ = tx.send(*v);
            },
        )
        .unwrap();

        assert_eq!(rx.recv_timeout(Duration::from_millis(200)).unwrap(), 1);
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), 2);
        // `latest` is updated right after the sink runs.
        std::thread::sleep(Duration::from_millis(20));
        assert!(s.latest().unwrap() >= 2);
    }

    #[test]
    fn stop_is_prompt_even_with_long_interval() {
        let s = Sampler::spawn("test", MAX_INTERVAL, || 0u8, |_| {}).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        let t = Instant::now();
        s.stop();
        assert!(
            t.elapsed() < Duration::from_secs(1),
            "took {:?}",
            t.elapsed()
        );
        s.stop(); // idempotent
    }

    #[test]
    fn shortening_interval_takes_effect_without_waiting_out_the_old_one() {
        let (tx, rx) = mpsc::channel();
        let s = Sampler::spawn(
            "test",
            MAX_INTERVAL,
            || (),
            move |_| {
                let _ = tx.send(());
            },
        )
        .unwrap();
        rx.recv_timeout(Duration::from_millis(500)).unwrap(); // first tick
        assert_eq!(s.set_interval(Duration::from_millis(1)), MIN_INTERVAL);
        // Next tick arrives ~250 ms after the first, not 10 s.
        rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(s.interval(), MIN_INTERVAL);
    }
}
