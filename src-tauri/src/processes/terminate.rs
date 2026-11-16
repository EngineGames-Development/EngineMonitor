//! Guarded process termination.
//!
//! The frontend must send both the PID and the start time it showed the user
//! in the confirmation dialog. Termination proceeds only if the process with
//! that PID still has that start time, so a PID that was reused by another
//! process in the meantime is never killed by mistake.
//!
//! Refused outright: PID 0, EngineMonitor itself, and processes whose
//! termination would crash or log off the session (see `is_critical`).
//! Everything else is subject to normal OS permissions; EngineMonitor never
//! elevates.

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::error::{AppError, AppResult};

/// Windows processes that are critical to the session or the OS. Ending them
/// (which requires elevation anyway) bug-checks or logs off the machine.
const WINDOWS_CRITICAL: &[&str] = &[
    "system",
    "secure system",
    "registry",
    "memory compression",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "lsaiso.exe",
];

pub fn is_critical(pid: u32, name: &str) -> bool {
    if cfg!(windows) {
        pid == 4 || WINDOWS_CRITICAL.contains(&name.to_ascii_lowercase().as_str())
    } else {
        pid == 1 // init / launchd
    }
}

/// Cheap checks that need no OS access.
fn precheck(pid: u32, own_pid: u32) -> AppResult<()> {
    if pid == 0 {
        return Err(AppError::InvalidArgument(
            "PID 0 cannot be terminated".into(),
        ));
    }
    if pid == own_pid {
        return Err(AppError::InvalidArgument(
            "EngineMonitor will not terminate itself; close the window instead".into(),
        ));
    }
    Ok(())
}

/// Validates the request against a fresh view of the process.
/// Returns the process name for messages.
fn check(pid: u32, expected_start_time: u64) -> AppResult<String> {
    let mut sys = System::new().map_err(|e| AppError::Internal(e.to_string()))?;
    let spid = Pid::from_u32(pid);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[spid]),
        true,
        ProcessRefreshKind::nothing(),
    );
    let process = sys.process(spid).ok_or_else(|| {
        AppError::NotFound(format!(
            "no running process with PID {pid} (it may have exited)"
        ))
    })?;
    if process.start_time() != expected_start_time {
        return Err(AppError::NotFound(format!(
            "the process with PID {pid} has exited; the PID now belongs to a different process"
        )));
    }
    let name = process.name().to_string_lossy().into_owned();
    if is_critical(pid, &name) {
        return Err(AppError::PermissionDenied(format!(
            "{name} (PID {pid}) is critical to the operating system and will not be terminated"
        )));
    }
    Ok(name)
}

/// Terminates the process `pid` if it still has `expected_start_time`.
pub fn terminate(pid: u32, expected_start_time: u64) -> AppResult<()> {
    precheck(pid, std::process::id())?;
    #[cfg(windows)]
    {
        windows_impl::terminate(pid, expected_start_time)
    }
    #[cfg(not(windows))]
    {
        let name = check(pid, expected_start_time)?;
        let mut sys = System::new().map_err(|e| AppError::Internal(e.to_string()))?;
        let spid = Pid::from_u32(pid);
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[spid]),
            true,
            ProcessRefreshKind::nothing(),
        );
        let process = sys
            .process(spid)
            .ok_or_else(|| AppError::NotFound(format!("process {pid} exited")))?;
        match process.kill_with(sysinfo::Signal::Term) {
            Some(true) => Ok(()),
            Some(false) => Err(AppError::PermissionDenied(format!(
                "the operating system refused to terminate {name} (PID {pid}); \
                 it may belong to another user"
            ))),
            None => Err(AppError::Unsupported(
                "process termination is not supported on this platform".into(),
            )),
        }
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::check;
    use crate::error::{AppError, AppResult};
    use windows::Win32::Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, HANDLE,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    /// Closes the handle on drop.
    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful OpenProcess and is
            // closed exactly once, here.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn map_error(e: windows::core::Error, pid: u32, action: &str) -> AppError {
        if e.code() == ERROR_ACCESS_DENIED.to_hresult() {
            AppError::PermissionDenied(format!(
                "access denied while trying to {action} PID {pid}; the process is protected \
                 or runs with higher privileges than EngineMonitor"
            ))
        } else if e.code() == ERROR_INVALID_PARAMETER.to_hresult() {
            AppError::NotFound(format!("no running process with PID {pid}"))
        } else {
            AppError::Internal(format!("could not {action} PID {pid}: {}", e.message()))
        }
    }

    pub fn terminate(pid: u32, expected_start_time: u64) -> AppResult<()> {
        // Open first: while we hold a handle, Windows cannot reuse the PID,
        // so the start-time check below cannot race with PID reuse.
        // SAFETY: plain FFI call with value arguments; the returned handle is
        // owned by `OwnedHandle`.
        let handle = unsafe {
            OpenProcess(
                PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                pid,
            )
        }
        .map(OwnedHandle)
        .map_err(|e| map_error(e, pid, "open"))?;

        let name = check(pid, expected_start_time)?;

        // SAFETY: `handle.0` is a valid process handle opened with
        // PROCESS_TERMINATE above and still owned by us.
        unsafe { TerminateProcess(handle.0, 1) }
            .map_err(|e| map_error(e, pid, &format!("terminate {name},")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_pid_zero_and_self() {
        assert!(matches!(terminate(0, 0), Err(AppError::InvalidArgument(_))));
        let own = std::process::id();
        let own_start = {
            let mut sys = System::new().unwrap();
            sys.refresh_processes_specifics(
                ProcessesToUpdate::Some(&[Pid::from_u32(own)]),
                true,
                ProcessRefreshKind::nothing(),
            );
            sys.process(Pid::from_u32(own)).unwrap().start_time()
        };
        assert!(matches!(
            terminate(own, own_start),
            Err(AppError::InvalidArgument(_))
        ));
    }

    #[test]
    fn critical_processes_are_recognised() {
        if cfg!(windows) {
            assert!(is_critical(4, "System"));
            assert!(is_critical(700, "CSRSS.EXE"));
            assert!(is_critical(800, "lsass.exe"));
            assert!(!is_critical(900, "notepad.exe"));
        } else {
            assert!(is_critical(1, "init"));
            assert!(!is_critical(900, "bash"));
        }
    }

    #[test]
    fn unknown_pid_is_not_found() {
        // PIDs are multiples of 4 on Windows; this one is very unlikely to exist.
        let r = terminate(4_294_967_292, 0);
        assert!(
            matches!(
                r,
                Err(AppError::NotFound(_)) | Err(AppError::InvalidArgument(_))
            ),
            "got {r:?}"
        );
    }

    #[test]
    fn terminates_a_child_process_and_rejects_stale_start_time() {
        let exe = if cfg!(windows) { "cmd" } else { "sleep" };
        let args: &[&str] = if cfg!(windows) {
            &["/C", "ping -n 30 127.0.0.1 >NUL"]
        } else {
            &["30"]
        };
        let mut child = std::process::Command::new(exe).args(args).spawn().unwrap();
        let pid = child.id();
        let start = {
            let mut sys = System::new().unwrap();
            sys.refresh_processes_specifics(
                ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
                true,
                ProcessRefreshKind::nothing(),
            );
            sys.process(Pid::from_u32(pid)).unwrap().start_time()
        };

        // Wrong start time (simulates PID reuse): refused, process untouched.
        assert!(matches!(
            terminate(pid, start + 1),
            Err(AppError::NotFound(_))
        ));
        assert!(child.try_wait().unwrap().is_none(), "child must still run");

        terminate(pid, start).expect("terminate own child");
        let status = child.wait().unwrap();
        assert!(!status.success());
    }
}
