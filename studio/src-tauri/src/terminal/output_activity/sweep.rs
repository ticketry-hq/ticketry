use std::time::Duration;

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait};
use tauri::async_runtime::JoinHandle;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use crate::entities::{runs::agent_run, terminals::session};

use super::TerminalOutputActivityService;

pub const DEFAULT_SWEEP_INTERVAL: Duration = Duration::from_secs(10);
pub const OUTPUT_SWEEP_INTERVAL_ENV: &str = "MUXED_OUTPUT_SWEEP_SECONDS";
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

pub fn configured_sweep_interval() -> Option<Duration> {
    parse_sweep_interval(std::env::var(OUTPUT_SWEEP_INTERVAL_ENV).ok().as_deref())
}

fn parse_sweep_interval(raw: Option<&str>) -> Option<Duration> {
    let Some(raw) = raw else {
        return Some(DEFAULT_SWEEP_INTERVAL);
    };
    let seconds = raw.parse::<f64>().ok()?;
    if !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }
    Duration::try_from_secs_f64(seconds).ok()
}

/// One application-owned loop. Cancellation drops an in-flight enumeration or
/// capture, so desktop shutdown never waits for an unavailable tmux runtime.
pub struct LiveOutputSweepRuntime {
    cancellation: CancellationToken,
    worker: Option<JoinHandle<()>>,
}

impl LiveOutputSweepRuntime {
    pub fn start(service: TerminalOutputActivityService, interval: Option<Duration>) -> Self {
        let cancellation = CancellationToken::new();
        let worker = interval.map(|interval| {
            let stop = cancellation.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::select! {
                        biased;
                        _ = stop.cancelled() => break,
                        _ = observe_live_sessions(&service) => {}
                    }
                    tokio::select! {
                        biased;
                        _ = stop.cancelled() => break,
                        _ = tokio::time::sleep(interval) => {}
                    }
                }
            })
        });
        Self {
            cancellation,
            worker,
        }
    }

    pub async fn shutdown(mut self) {
        self.cancellation.cancel();
        if let Some(mut worker) = self.worker.take() {
            if timeout(SHUTDOWN_TIMEOUT, &mut worker).await.is_err() {
                worker.abort();
            }
        }
    }
}

/// Observe one stable pass. Enumeration failure ends this pass. Capture or
/// persistence failure skips one session and leaves later sessions eligible.
pub async fn observe_live_sessions(service: &TerminalOutputActivityService) -> usize {
    let namespace = match crate::tmux_adapter::current_runtime_namespace() {
        Ok(namespace) => namespace,
        Err(error) => {
            eprintln!("Ticketry live output sweep could not resolve its namespace: {error}");
            return 0;
        }
    };
    let live_runs = agent_run::Entity::find()
        .select_only()
        .column(agent_run::Column::Id)
        .filter(agent_run::Column::EndedAt.is_null())
        .into_query();
    let session_ids = match session::Entity::find()
        .select_only()
        .column(session::Column::AgentRunId)
        .filter(session::Column::TerminatedAt.is_null())
        .filter(session::Column::RuntimeCleanupPending.eq(false))
        .filter(session::Column::RuntimeNamespace.eq(namespace))
        .filter(session::Column::AgentRunId.in_subquery(live_runs))
        .order_by_asc(session::Column::CreatedAt)
        .order_by_asc(session::Column::AgentRunId)
        .into_tuple::<String>()
        .all(&service.database)
        .await
    {
        Ok(ids) => ids,
        Err(error) => {
            eprintln!("Ticketry live output sweep could not list sessions: {error}");
            return 0;
        }
    };

    let mut advanced = 0;
    for agent_run_id in session_ids {
        match service.observe(&agent_run_id).await {
            Ok(observation) if observation.advanced => advanced += 1,
            Ok(_) => {}
            Err(error) => {
                eprintln!("Ticketry live output sweep could not observe {agent_run_id}: {error}");
            }
        }
    }
    advanced
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_validation_matches_the_public_configuration_contract() {
        assert_eq!(parse_sweep_interval(None), Some(DEFAULT_SWEEP_INTERVAL));
        assert_eq!(
            parse_sweep_interval(Some("2.5")),
            Some(Duration::from_millis(2_500))
        );
        for raw in ["0", "-1", "NaN", "inf", "not-a-number"] {
            assert!(
                parse_sweep_interval(Some(raw)).is_none(),
                "{raw} must disable the sweep"
            );
        }
        assert_eq!(DEFAULT_SWEEP_INTERVAL, Duration::from_secs(10));
    }
}
