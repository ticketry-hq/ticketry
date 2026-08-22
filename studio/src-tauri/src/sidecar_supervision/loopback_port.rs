//! Reserving the loopback port a sidecar will bind.
//!
//! The listener is held open until the moment of spawn so nothing else on the
//! machine can take the port in between.

use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

use super::error::{FailureKind, SupervisorError};

pub(super) fn reserve_loopback_port(candidates: &[u16]) -> Result<TcpListener, SupervisorError> {
    let candidates: Vec<u16> = if candidates.is_empty() {
        vec![0; 8]
    } else {
        candidates.to_vec()
    };
    for candidate in candidates {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", candidate)) {
            return Ok(listener);
        }
    }
    Err(SupervisorError::new(
        FailureKind::Bind,
        "could not reserve a loopback port after the configured retries",
    ))
}

pub(super) fn select_loopback_port(candidates: &[u16]) -> Result<u16, SupervisorError> {
    let listener = reserve_loopback_port(candidates)?;
    let port = listener
        .local_addr()
        .expect("listener has local address")
        .port();
    drop(listener);
    Ok(port)
}

pub(super) fn reserve_pinned_loopback_port(
    port: u16,
    retry_timeout: Duration,
    retry_interval: Duration,
) -> Result<TcpListener, SupervisorError> {
    let deadline = Instant::now() + retry_timeout;
    loop {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok(listener);
        }
        if Instant::now() >= deadline {
            return Err(SupervisorError::new(
                FailureKind::Bind,
                format!("could not rebind pinned port {port}"),
            ));
        }
        thread::sleep(retry_interval.min(deadline.saturating_duration_since(Instant::now())));
    }
}

pub(super) fn select_pinned_loopback_port(
    port: u16,
    retry_timeout: Duration,
    retry_interval: Duration,
) -> Result<u16, SupervisorError> {
    drop(reserve_pinned_loopback_port(
        port,
        retry_timeout,
        retry_interval,
    )?);
    Ok(port)
}
