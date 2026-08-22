//! What the supervisor reports as it runs.
//!
//! Events are the only narration the desktop shell consumes; nothing here
//! carries a credential or a raw log line.

use super::error::FailureKind;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum SupervisorEvent {
    Spawned {
        service: String,
        port: u16,
    },
    Ready {
        service: String,
        port: u16,
    },
    Exited {
        service: String,
        status: Option<i32>,
    },
    Restarting {
        service: String,
        attempt: usize,
    },
    RecoveryQueued {
        service: String,
    },
    SidecarLogUnavailable {
        message: String,
    },
    McpPortRollover {
        previous_port: u16,
        active_port: u16,
    },
    ShutdownTermRequested {
        service: String,
    },
    ShutdownKillRequested {
        service: String,
    },
    Failed {
        service: String,
        kind: FailureKind,
        message: String,
    },
}
