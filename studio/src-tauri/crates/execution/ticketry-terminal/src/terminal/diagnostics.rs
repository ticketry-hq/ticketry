//! Durable, low-volume probes for terminal runtime failures.

use serde_json::Value;

pub(crate) fn record(event: &str, agent_run_id: Option<&str>, details: Value) {
    ticketry_diagnostics::record_launch_discovery(
        ticketry_diagnostics::LaunchDiscoveryRecord::new(
            event,
            ticketry_diagnostics::runtime_instance(),
            None,
            agent_run_id,
            None,
            None,
            None,
        )
        .with_detail("terminalProbe", details),
    );
}
