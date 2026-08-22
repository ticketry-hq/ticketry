use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use crate::terminal_lifecycle::TerminalLifecycleRuntime;

use super::{service::DEFAULT_BATCH_SIZE, ExecutionReconciliationService};

#[derive(Clone, Copy, Debug)]
pub struct ExecutionReconciliationConfig {
    pub batch_size: u64,
    pub pass_interval: Duration,
    pub operation_timeout: Duration,
    pub shutdown_timeout: Duration,
}

impl Default for ExecutionReconciliationConfig {
    fn default() -> Self {
        Self {
            batch_size: DEFAULT_BATCH_SIZE,
            pass_interval: Duration::from_secs(5),
            operation_timeout: Duration::from_secs(30),
            shutdown_timeout: Duration::from_secs(3),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionReconciliationError(String);

impl std::fmt::Display for ExecutionReconciliationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ExecutionReconciliationError {}

/// Starts only after Terminal recovery is ready. Shutdown closes mutation
/// readiness before cancelling future passes and never resets durable rows.
pub struct ExecutionReconciliationRuntime {
    ready: Arc<AtomicBool>,
    cancellation: CancellationToken,
    worker: Mutex<Option<JoinHandle<()>>>,
    shutdown_timeout: Duration,
}

impl ExecutionReconciliationRuntime {
    pub async fn start(
        service: ExecutionReconciliationService,
        terminal: Arc<TerminalLifecycleRuntime>,
        config: ExecutionReconciliationConfig,
    ) -> Result<Self, ExecutionReconciliationError> {
        if !terminal.is_ready() {
            return Err(ExecutionReconciliationError(
                "Terminal recovery is not ready.".to_owned(),
            ));
        }
        let ready = Arc::new(AtomicBool::new(false));
        let cancellation = CancellationToken::new();
        let runtime = Self {
            ready: Arc::clone(&ready),
            cancellation: cancellation.clone(),
            worker: Mutex::new(None),
            shutdown_timeout: config.shutdown_timeout,
        };

        let startup = async {
            let automation = service.reconcile_automation(config.batch_size).await;
            log_failures(&automation);
            terminal.request_sweep().await;
            let mut cursor = None;
            loop {
                let report = service
                    .reconcile_armed_batch(cursor.as_deref(), config.batch_size)
                    .await;
                log_failures(&report);
                if let Some(error) = report.diagnostics.first() {
                    return Err(error.clone());
                }
                if report.needs_terminal_reconciliation() {
                    terminal.request_sweep().await;
                }
                let Some(next) = report.next_root_id else {
                    break;
                };
                cursor = Some(next);
                tokio::task::yield_now().await;
            }
            Ok::<(), String>(())
        };
        timeout(config.operation_timeout, startup)
            .await
            .map_err(|_| {
                ExecutionReconciliationError(
                    "Initial execution reconciliation exceeded its deadline.".to_owned(),
                )
            })?
            .map_err(ExecutionReconciliationError)?;

        ready.store(true, Ordering::Release);
        crate::graph_run_service::set_production_mutations_open(true);
        if !config.pass_interval.is_zero() {
            let worker = tokio::spawn(async move {
                let mut ticker = tokio::time::interval(config.pass_interval);
                ticker.tick().await;
                let mut cursor = None;
                loop {
                    tokio::select! {
                        biased;
                        _ = cancellation.cancelled() => break,
                        _ = ticker.tick() => {
                            let pass = async {
                                let automation = service.reconcile_automation(config.batch_size).await;
                                log_failures(&automation);
                                let events = service.reconcile_recent_events(config.batch_size).await;
                                log_failures(&events);
                                let roots = service.reconcile_armed_batch(cursor.as_deref(), config.batch_size).await;
                                log_failures(&roots);
                                cursor = roots.next_root_id.clone();
                                if events.needs_terminal_reconciliation() || roots.needs_terminal_reconciliation() {
                                    terminal.request_sweep().await;
                                }
                            };
                            let _ = timeout(config.operation_timeout, pass).await;
                        }
                    }
                }
            });
            *runtime.worker.lock().await = Some(worker);
        }
        Ok(runtime)
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }

    pub async fn shutdown(&self) {
        self.ready.store(false, Ordering::Release);
        crate::graph_run_service::set_production_mutations_open(false);
        self.cancellation.cancel();
        if let Some(mut worker) = self.worker.lock().await.take() {
            if timeout(self.shutdown_timeout, &mut worker).await.is_err() {
                worker.abort();
            }
        }
    }
}

fn log_failures(report: &super::ExecutionReconciliationReport) {
    for error in &report.automation_failures {
        eprintln!("Ticketry execution automation reconciliation failed: {error}");
    }
    for error in &report.diagnostics {
        eprintln!("Ticketry execution reconciliation could not read durable facts: {error}");
    }
    for root in report.roots.iter().filter(|root| root.error.is_some()) {
        eprintln!(
            "Ticketry could not reconcile armed root {}: {}",
            root.root_id,
            root.error.as_deref().unwrap_or("unknown error")
        );
    }
}
