//! Tauri-managed state for process-local services and desktop events.

use std::collections::HashSet;
use std::sync::{atomic::AtomicBool, Mutex};
use tauri::Emitter;

use crate::desktop::readiness_publication::ReadinessPublication;
use crate::desktop::runtime_configuration::RuntimeStartupConfiguration;
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::user_notices::UserNotice;

pub(crate) const HEALTH_EVENT: &str = "desktop-service-health";
pub(crate) const USER_NOTICE_EVENT: &str = "desktop-user-notice";

pub(crate) struct DesktopServiceState {
    pub(crate) mcp_runtime: Mutex<Option<crate::mcp::McpRuntime>>,
    pub(crate) terminal_runtime:
        Mutex<Option<std::sync::Arc<crate::terminal::lifecycle::TerminalLifecycleRuntime>>>,
    pub(crate) hook_spool_runtime: Mutex<Option<ticketry_runs::hook_spool::HookSpoolRuntime>>,
    pub(crate) execution_runtime:
        Mutex<Option<crate::execution::reconciliation::ExecutionReconciliationRuntime>>,
    pub(crate) terminal_launch: Mutex<Option<crate::terminal::launch::TerminalLaunchService>>,
    pub(crate) output_sweep:
        Mutex<Option<crate::terminal::output_activity::LiveOutputSweepRuntime>>,
    pub(crate) configuration: Mutex<Option<RuntimeStartupConfiguration>>,
    pub(crate) health: Mutex<ServiceHealth>,
    pub(crate) notices: Mutex<Vec<UserNotice>>,
    pub(crate) notice_ids: Mutex<HashSet<String>>,
    pub(crate) readiness: ReadinessPublication,
    pub(crate) stopping: AtomicBool,
}

impl DesktopServiceState {
    pub(crate) fn new() -> Self {
        Self {
            mcp_runtime: Mutex::new(None),
            terminal_runtime: Mutex::new(None),
            hook_spool_runtime: Mutex::new(None),
            execution_runtime: Mutex::new(None),
            terminal_launch: Mutex::new(None),
            output_sweep: Mutex::new(None),
            configuration: Mutex::new(None),
            health: Mutex::new(ServiceHealth::starting()),
            notices: Mutex::new(Vec::new()),
            notice_ids: Mutex::new(HashSet::new()),
            readiness: ReadinessPublication::new(),
            stopping: AtomicBool::new(false),
        }
    }

    pub(crate) fn record_health(&self, health: ServiceHealth) {
        *self.health.lock().expect("service health lock poisoned") = health;
    }

    pub(crate) fn publish(&self, application: &tauri::AppHandle, health: ServiceHealth) {
        self.record_health(health.clone());
        let _ = application.emit(HEALTH_EVENT, health);
    }

    pub(crate) fn retain_notice(&self, notice: UserNotice) -> bool {
        let inserted = self
            .notice_ids
            .lock()
            .expect("user notice id lock poisoned")
            .insert(notice.id.clone());
        if inserted {
            self.notices
                .lock()
                .expect("user notice lock poisoned")
                .push(notice);
        }
        inserted
    }

    pub(crate) fn publish_notice(&self, application: &tauri::AppHandle, notice: UserNotice) {
        if self.retain_notice(notice.clone()) {
            let _ = application.emit(USER_NOTICE_EVENT, notice);
        }
    }

    pub(crate) fn configuration(&self) -> Result<RuntimeStartupConfiguration, String> {
        let mut configuration = self
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned")
            .clone()
            .ok_or_else(|| {
                "Ticketry is still starting; wait for its service-health event".to_owned()
            })?;
        configuration.service_health = self
            .health
            .lock()
            .expect("service health lock poisoned")
            .clone();
        configuration.initial_notices = self
            .notices
            .lock()
            .expect("user notice lock poisoned")
            .clone();
        Ok(configuration)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop::runtime_configuration::rust_runtime_configuration;

    #[test]
    fn runtime_configuration_uses_live_health_after_failed_publication() {
        let state = DesktopServiceState::new();
        let stored_configuration = rust_runtime_configuration();
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") = Some(stored_configuration);
        let failed = ServiceHealth::failed_runtime(
            "runtime stopped".to_owned(),
            std::path::Path::new("/tmp/ticketry.log"),
        );
        state.record_health(failed.clone());

        let configuration = state.configuration().expect("runtime configuration");

        assert_eq!(configuration.service_health, failed);
    }
}
