//! Persist recovery failures, including cancellation by the sweep deadline.

use std::time::{Duration, Instant};

use super::TerminalLifecycleWork;

pub(super) async fn run(
    work: &dyn TerminalLifecycleWork,
    deadline: Duration,
) -> Result<(), String> {
    let started = Instant::now();
    let mut stage = "provider-hook-drain";
    let pass = async {
        work.drain_spool().await?;
        stage = "terminal-reconciliation";
        work.reconcile().await?;
        stage = "viewer-lease-expiry";
        work.expire_stale_viewer_leases().await?;
        Ok::<(), String>(())
    };
    let result = match tokio::time::timeout(deadline, pass).await {
        Ok(result) => result.map_err(|error| format!("{stage} failed: {error}")),
        Err(_) => Err(format!("{stage} exceeded the terminal sweep deadline")),
    };
    if let Err(error) = &result {
        eprintln!("Ticketry terminal sweep failed: {error}");
        let _ = ticketry_diagnostics::process_file_log().record(
            "terminal",
            "error",
            "sweep-failed",
            serde_json::json!({
                "stage": stage,
                "error": error,
                "elapsedMs": started.elapsed().as_millis(),
                "deadlineMs": deadline.as_millis(),
            }),
        );
    }
    result
}
