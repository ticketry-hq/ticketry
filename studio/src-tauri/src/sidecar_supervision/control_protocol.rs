//! The single-line protocol a sidecar uses to announce readiness or failure.
//!
//! Anything that is not one of these two prefixes is log output, never control
//! traffic.

use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::error::{FailureKind, SupervisorError};

pub(super) const READINESS_PREFIX: &str = "MUXED_READY service=backend port=";
pub(super) const FAILURE_PREFIX: &str = "MUXED_FAILURE ";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ControlLine {
    Ready,
    Failure(FailureKind, String),
    Other,
}

pub(super) fn drain_control_failures(
    receiver: &mpsc::Receiver<String>,
    expected_port: u16,
    bound: Duration,
) -> Option<SupervisorError> {
    let deadline = Instant::now() + bound;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(5))) {
            Ok(line) => {
                if let ControlLine::Failure(kind, message) =
                    parse_control_line(&line, expected_port)
                {
                    return Some(SupervisorError::new(kind, message));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    }
}

pub(super) fn parse_control_line(line: &str, expected_port: u16) -> ControlLine {
    if line == format!("{READINESS_PREFIX}{expected_port}") {
        return ControlLine::Ready;
    }
    if serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .is_some_and(|event| {
            event.get("event").and_then(|value| value.as_str()) == Some("ready")
                && event.get("host").and_then(|value| value.as_str()) == Some("127.0.0.1")
                && event.get("port").and_then(|value| value.as_u64()) == Some(expected_port.into())
        })
    {
        return ControlLine::Ready;
    }
    let Some(failure) = line.strip_prefix(FAILURE_PREFIX) else {
        return ControlLine::Other;
    };
    let (class, message) = failure
        .split_once(' ')
        .unwrap_or((failure, "sidecar failure"));
    // A class this build does not know still announced a failure. Dropping it
    // to `Other` degrades a reported failure into a readiness timeout that is
    // retried until the restart budget is gone, so an unknown class is treated
    // as a crash and keeps its raw class in the message.
    match class {
        "migration" => ControlLine::Failure(FailureKind::Migration, message.to_owned()),
        "authentication" => ControlLine::Failure(FailureKind::Authentication, message.to_owned()),
        "bind" => ControlLine::Failure(FailureKind::Bind, message.to_owned()),
        "crash" => ControlLine::Failure(FailureKind::Crash, message.to_owned()),
        _ => ControlLine::Failure(FailureKind::Crash, format!("{class}: {message}")),
    }
}
