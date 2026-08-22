use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use super::TerminalLifecycleWork;

#[derive(Clone, Copy, Debug)]
pub struct TerminalLifecycleConfig {
    pub operation_timeout: Duration,
    pub shutdown_timeout: Duration,
    /// Zero disables periodic work without disabling the required startup pass.
    pub sweep_interval: Duration,
}

impl Default for TerminalLifecycleConfig {
    fn default() -> Self {
        Self {
            operation_timeout: Duration::from_secs(10),
            shutdown_timeout: Duration::from_secs(3),
            sweep_interval: Duration::from_secs(15),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalLifecycleError {
    message: String,
}

impl TerminalLifecycleError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for TerminalLifecycleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TerminalLifecycleError {}

struct SweepState {
    running: AtomicBool,
    requested: AtomicBool,
}

impl Default for SweepState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            requested: AtomicBool::new(false),
        }
    }
}

/// One process-wide lifecycle owner. Readiness opens only after the ordered
/// startup pass and closes before any shutdown work begins.
pub struct TerminalLifecycleRuntime {
    work: Arc<dyn TerminalLifecycleWork>,
    config: TerminalLifecycleConfig,
    ready: Arc<AtomicBool>,
    cancellation: CancellationToken,
    worker: Mutex<Option<JoinHandle<()>>>,
    sweep: Arc<SweepState>,
}

impl TerminalLifecycleRuntime {
    pub async fn start(
        work: Arc<dyn TerminalLifecycleWork>,
        config: TerminalLifecycleConfig,
    ) -> Result<Self, TerminalLifecycleError> {
        let runtime = Self {
            work,
            config,
            ready: Arc::new(AtomicBool::new(false)),
            cancellation: CancellationToken::new(),
            worker: Mutex::new(None),
            sweep: Arc::new(SweepState::default()),
        };

        runtime
            .required("Terminal schema verification", runtime.work.verify_schema())
            .await?;
        runtime
            .required("initial provider hook drain", runtime.work.drain_spool())
            .await?;
        runtime
            .required("initial terminal reconciliation", runtime.work.reconcile())
            .await?;
        runtime
            .required("viewer lease expiry", runtime.work.expire_viewer_leases())
            .await?;

        runtime.ready.store(true, Ordering::Release);
        runtime.start_periodic().await;
        Ok(runtime)
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }

    /// Ask for a bounded pass. Concurrent callers coalesce into the current
    /// pass plus at most one immediate follow-up.
    pub async fn request_sweep(&self) {
        request_sweep(
            Arc::clone(&self.work),
            self.config.operation_timeout,
            Arc::clone(&self.sweep),
        )
        .await;
    }

    pub async fn shutdown(&self) -> Result<(), TerminalLifecycleError> {
        self.ready.store(false, Ordering::Release);
        self.cancellation.cancel();
        if let Some(worker) = self.worker.lock().await.take() {
            let _ = timeout(self.config.shutdown_timeout, worker).await;
        }

        self.required_with(
            "final provider hook drain",
            self.config.shutdown_timeout,
            self.work.drain_spool(),
        )
        .await?;
        self.required_with(
            "shutdown viewer lease expiry",
            self.config.shutdown_timeout,
            self.work.expire_viewer_leases(),
        )
        .await?;
        Ok(())
    }

    async fn start_periodic(&self) {
        if self.config.sweep_interval.is_zero() {
            return;
        }
        let work = Arc::clone(&self.work);
        let sweep = Arc::clone(&self.sweep);
        let cancellation = self.cancellation.clone();
        let interval = self.config.sweep_interval;
        let operation_timeout = self.config.operation_timeout;
        let worker = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.tick().await;
            loop {
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    _ = ticker.tick() => {
                        request_sweep(Arc::clone(&work), operation_timeout, Arc::clone(&sweep)).await;
                    }
                }
            }
        });
        *self.worker.lock().await = Some(worker);
    }

    async fn required<T>(
        &self,
        name: &str,
        future: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, TerminalLifecycleError> {
        self.required_with(name, self.config.operation_timeout, future)
            .await
    }

    async fn required_with<T>(
        &self,
        name: &str,
        deadline: Duration,
        future: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, TerminalLifecycleError> {
        match timeout(deadline, future).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(TerminalLifecycleError::new(format!(
                "{name} failed: {error}"
            ))),
            Err(_) => Err(TerminalLifecycleError::new(format!(
                "{name} exceeded its deadline"
            ))),
        }
    }
}

async fn request_sweep(
    work: Arc<dyn TerminalLifecycleWork>,
    deadline: Duration,
    state: Arc<SweepState>,
) {
    state.requested.store(true, Ordering::Release);
    if state
        .running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    loop {
        state.requested.store(false, Ordering::Release);
        let pass = async {
            work.drain_spool().await?;
            work.reconcile().await?;
            work.expire_viewer_leases().await?;
            Ok::<(), String>(())
        };
        if let Ok(Err(error)) = timeout(deadline, pass).await {
            eprintln!("Ticketry terminal sweep failed: {error}");
        }
        if !state.requested.swap(false, Ordering::AcqRel) {
            state.running.store(false, Ordering::Release);
            if !state.requested.load(Ordering::Acquire) {
                break;
            }
            if state
                .running
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    use async_trait::async_trait;

    use super::*;
    use crate::hook_spool::DrainReport;
    use crate::terminal_cleanup::TerminalCleanupRecoveryReport;
    use crate::terminal_launch::TerminalLaunchRecoveryReport;
    use crate::terminal_reconciliation::TerminalReconciliationReport;

    #[derive(Default)]
    struct FakeWork {
        events: std::sync::Mutex<Vec<&'static str>>,
        drains: AtomicUsize,
        reconciliations: AtomicUsize,
        active_reconciliations: AtomicUsize,
        max_reconciliations: AtomicUsize,
        fail_reconciliation: AtomicUsize,
        drain_delay_ms: AtomicUsize,
        reconciliation_delay_ms: AtomicUsize,
    }

    impl FakeWork {
        fn report() -> TerminalReconciliationReport {
            TerminalReconciliationReport {
                launches: TerminalLaunchRecoveryReport::default(),
                cleanups: TerminalCleanupRecoveryReport::default(),
                sessions: Vec::new(),
                sessions_saturated: false,
                unrecorded: Vec::new(),
                conflicts: Vec::new(),
                inventory_unavailable: false,
            }
        }

        fn event(&self, event: &'static str) {
            self.events.lock().expect("event lock").push(event);
        }

        fn events(&self) -> Vec<&'static str> {
            self.events.lock().expect("event lock").clone()
        }
    }

    #[async_trait]
    impl TerminalLifecycleWork for FakeWork {
        async fn verify_schema(&self) -> Result<(), String> {
            self.event("schema");
            Ok(())
        }

        async fn drain_spool(&self) -> Result<DrainReport, String> {
            self.event("spool");
            self.drains.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(
                self.drain_delay_ms.load(Ordering::SeqCst) as u64,
            ))
            .await;
            Ok(DrainReport::default())
        }

        async fn reconcile(&self) -> Result<TerminalReconciliationReport, String> {
            self.event("reconcile");
            let call = self.reconciliations.fetch_add(1, Ordering::SeqCst) + 1;
            let active = self.active_reconciliations.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_reconciliations.fetch_max(active, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(
                self.reconciliation_delay_ms.load(Ordering::SeqCst) as u64,
            ))
            .await;
            self.active_reconciliations.fetch_sub(1, Ordering::SeqCst);
            if call == self.fail_reconciliation.load(Ordering::SeqCst) {
                Err("injected observation failure".to_owned())
            } else {
                Ok(Self::report())
            }
        }

        async fn expire_viewer_leases(&self) -> Result<u64, String> {
            self.event("leases");
            Ok(1)
        }
    }

    fn config(interval: Duration) -> TerminalLifecycleConfig {
        TerminalLifecycleConfig {
            operation_timeout: Duration::from_millis(200),
            shutdown_timeout: Duration::from_millis(30),
            sweep_interval: interval,
        }
    }

    #[tokio::test]
    async fn readiness_opens_after_the_required_order_and_closes_before_shutdown() {
        let work = Arc::new(FakeWork::default());
        let runtime = TerminalLifecycleRuntime::start(work.clone(), config(Duration::ZERO))
            .await
            .expect("start terminal lifecycle");

        assert!(runtime.is_ready());
        assert_eq!(work.events(), ["schema", "spool", "reconcile", "leases"]);

        runtime
            .shutdown()
            .await
            .expect("shutdown terminal lifecycle");
        assert!(!runtime.is_ready());
        assert_eq!(
            work.events(),
            ["schema", "spool", "reconcile", "leases", "spool", "leases"]
        );
    }

    #[tokio::test]
    async fn disabled_periodic_interval_runs_no_background_pass() {
        let work = Arc::new(FakeWork::default());
        let runtime = TerminalLifecycleRuntime::start(work.clone(), config(Duration::ZERO))
            .await
            .expect("start terminal lifecycle");
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(work.reconciliations.load(Ordering::SeqCst), 1);
        runtime
            .shutdown()
            .await
            .expect("shutdown terminal lifecycle");
    }

    #[tokio::test]
    async fn required_startup_failure_never_reaches_readiness_or_background_work() {
        let work = Arc::new(FakeWork::default());
        work.fail_reconciliation.store(1, Ordering::SeqCst);

        let error = TerminalLifecycleRuntime::start(work.clone(), config(Duration::from_millis(1)))
            .await
            .err()
            .expect("startup must fail closed");

        assert!(error
            .to_string()
            .contains("initial terminal reconciliation"));
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(work.reconciliations.load(Ordering::SeqCst), 1);
        assert_eq!(work.events(), ["schema", "spool", "reconcile"]);
    }

    #[tokio::test]
    async fn overlapping_requests_are_single_flight_and_coalesce_once() {
        let work = Arc::new(FakeWork::default());
        work.reconciliation_delay_ms.store(20, Ordering::SeqCst);
        let runtime = Arc::new(
            TerminalLifecycleRuntime::start(work.clone(), config(Duration::ZERO))
                .await
                .expect("start terminal lifecycle"),
        );
        let baseline = work.reconciliations.load(Ordering::SeqCst);
        let mut requests = Vec::new();
        for _ in 0..32 {
            let runtime = runtime.clone();
            requests.push(tokio::spawn(async move { runtime.request_sweep().await }));
        }
        for request in requests {
            request.await.expect("sweep request");
        }

        assert_eq!(work.max_reconciliations.load(Ordering::SeqCst), 1);
        assert!(work.reconciliations.load(Ordering::SeqCst) <= baseline + 2);
        runtime
            .shutdown()
            .await
            .expect("shutdown terminal lifecycle");
    }

    #[tokio::test]
    async fn periodic_work_retries_after_a_failed_pass() {
        let work = Arc::new(FakeWork::default());
        work.fail_reconciliation.store(2, Ordering::SeqCst);
        let runtime =
            TerminalLifecycleRuntime::start(work.clone(), config(Duration::from_millis(5)))
                .await
                .expect("start terminal lifecycle");
        tokio::time::sleep(Duration::from_millis(35)).await;
        assert!(work.reconciliations.load(Ordering::SeqCst) >= 3);
        assert!(runtime.is_ready());
        runtime
            .shutdown()
            .await
            .expect("shutdown terminal lifecycle");
    }

    #[tokio::test]
    async fn final_drain_obeys_the_shutdown_deadline() {
        let work = Arc::new(FakeWork::default());
        let runtime = TerminalLifecycleRuntime::start(work.clone(), config(Duration::ZERO))
            .await
            .expect("start terminal lifecycle");
        work.drain_delay_ms.store(100, Ordering::SeqCst);
        let started = Instant::now();
        let error = runtime.shutdown().await.expect_err("deadline must fail");
        assert!(started.elapsed() < Duration::from_millis(90));
        assert!(error.to_string().contains("deadline"));
        assert!(!runtime.is_ready());
    }
}
