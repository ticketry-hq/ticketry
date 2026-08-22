//! The knobs a caller may set before launching.

use std::time::Duration;

#[derive(Debug, Clone)]
pub struct SupervisorOptions {
    pub readiness_timeout: Duration,
    pub shutdown_grace: Duration,
    pub bind_retry_timeout: Duration,
    pub bind_retry_interval: Duration,
    pub liveness_probe_interval: Duration,
    pub liveness_probe_timeout: Duration,
    pub liveness_failure_threshold: usize,
    pub restart_limit: usize,
    pub restart_backoff: Vec<Duration>,
    pub healthy_reset_interval: Duration,
    pub log_limit_bytes: usize,
    /// Aggregate byte ceiling across the active sidecar log and all rotated
    /// generations.
    pub sidecar_log_limit_bytes: usize,
    /// Includes the active sidecar log. A value of three retains
    /// `sidecar.log`, `sidecar.log.1`, and `sidecar.log.2`.
    pub sidecar_log_generations: usize,
    /// Testable port-selection candidates.  An empty list means OS-selected
    /// ephemeral ports; each candidate is attempted in order.
    pub port_candidates: Vec<u16>,
    /// Testable MCP port-selection candidates with the same semantics as
    /// `port_candidates`.
    pub mcp_port_candidates: Vec<u16>,
    /// Whether an MCP startup failure must also fail the primary backend
    /// launch. Desktop builds may keep the application usable without MCP.
    pub mcp_required: bool,
}

impl Default for SupervisorOptions {
    fn default() -> Self {
        Self {
            // A cold one-file PyInstaller extraction can take longer than 15
            // seconds on development machines. Keep this aligned with the
            // packaged-sidecar acceptance budget so a healthy backend is not
            // terminated just as it reports readiness.
            readiness_timeout: Duration::from_secs(30),
            shutdown_grace: Duration::from_secs(3),
            bind_retry_timeout: Duration::from_secs(2),
            bind_retry_interval: Duration::from_millis(100),
            liveness_probe_interval: Duration::from_secs(5),
            liveness_probe_timeout: Duration::from_secs(2),
            liveness_failure_threshold: 3,
            restart_limit: 5,
            restart_backoff: vec![
                Duration::ZERO,
                Duration::from_secs(1),
                Duration::from_secs(2),
                Duration::from_secs(4),
                Duration::from_secs(8),
            ],
            healthy_reset_interval: Duration::from_secs(60),
            log_limit_bytes: 64 * 1024,
            sidecar_log_limit_bytes: 1024 * 1024,
            sidecar_log_generations: 3,
            port_candidates: Vec::new(),
            mcp_port_candidates: Vec::new(),
            mcp_required: true,
        }
    }
}
