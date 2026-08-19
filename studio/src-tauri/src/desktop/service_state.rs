//! Tauri-managed state for the supervised service pair, plus the two event
//! names the desktop publishes to Studio.

use std::collections::HashSet;
use std::sync::{atomic::AtomicBool, Mutex};
use tauri::Emitter;

use crate::desktop::readiness_publication::ReadinessPublication;
use crate::desktop::runtime_configuration::RuntimeStartupConfiguration;
use crate::desktop::service_health::ServiceHealth;
use crate::desktop::user_notices::{supervisor_notice, UserNotice};
use crate::supervisor::{Supervisor, SupervisorEvent};
use crate::work_management;

pub(crate) const HEALTH_EVENT: &str = "desktop-service-health";
pub(crate) const USER_NOTICE_EVENT: &str = "desktop-user-notice";

pub(crate) struct DesktopServiceState {
    pub(crate) supervisor: Mutex<Option<Supervisor>>,
    pub(crate) mcp_runtime: Mutex<Option<work_management::mcp::McpRuntime>>,
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
            supervisor: Mutex::new(None),
            mcp_runtime: Mutex::new(None),
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

    pub(crate) fn retain_supervisor_notices(&self, events: &[SupervisorEvent]) -> Vec<UserNotice> {
        let mut notice_ids = self
            .notice_ids
            .lock()
            .expect("user notice id lock poisoned");
        let notices = events
            .iter()
            .filter_map(supervisor_notice)
            .filter(|notice| notice_ids.insert(notice.id.clone()))
            .collect::<Vec<_>>();
        if !notices.is_empty() {
            self.notices
                .lock()
                .expect("user notice lock poisoned")
                .extend(notices.iter().cloned());
        }
        notices
    }

    pub(crate) fn publish_supervisor_notices(
        &self,
        application: &tauri::AppHandle,
        events: &[SupervisorEvent],
    ) {
        for notice in self.retain_supervisor_notices(events) {
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
                "Desktop backend is still starting; wait for its service-health event".to_owned()
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
    use crate::desktop::runtime_configuration::sidecar_runtime_configuration;
    use crate::supervisor::{self, SupervisorError};
    use std::path::Path;

    #[test]
    fn runtime_configuration_uses_live_health_after_failed_publication() {
        let state = DesktopServiceState::new();
        let stored_configuration = sidecar_runtime_configuration(43_219, "per-launch-credential");
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") = Some(stored_configuration);
        let failed = ServiceHealth::failed(
            &SupervisorError {
                service: "backend".to_owned(),
                kind: supervisor::FailureKind::Crash,
                message: "restart allowance exhausted".to_owned(),
            },
            Path::new("/tmp/muxed-sidecar.log"),
        );
        state.record_health(failed.clone());

        let configuration = state.configuration().expect("runtime configuration");

        assert_eq!(configuration.service_health, failed);
    }

    #[test]
    fn mcp_rollover_is_retained_for_startup_and_deduplicated_by_incident() {
        let state = DesktopServiceState::new();
        *state
            .configuration
            .lock()
            .expect("runtime configuration lock poisoned") = Some(sidecar_runtime_configuration(
            43_219,
            "per-launch-credential",
        ));
        let rollover = supervisor::SupervisorEvent::McpPortRollover {
            previous_port: 43_101,
            active_port: 43_219,
        };

        assert_eq!(
            state.retain_supervisor_notices(&[rollover.clone()]).len(),
            1
        );
        assert!(state.retain_supervisor_notices(&[rollover]).is_empty());

        let configuration = state.configuration().expect("runtime configuration");
        assert_eq!(configuration.initial_notices.len(), 1);
        assert_eq!(
            configuration.initial_notices[0].id,
            "mcp-port-rollover:43101:43219"
        );
    }
}
