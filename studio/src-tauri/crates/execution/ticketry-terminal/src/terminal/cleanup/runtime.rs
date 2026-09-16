use async_trait::async_trait;

use crate::tmux_adapter::{
    InventoryEntry, KillOutcome, PersistedSessionName, RuntimeIdentity, RuntimeObservation,
    TmuxAdapter, TmuxSnapshot,
};
use ticketry_entities::session;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CleanupRuntimeObservation {
    Running,
    Exited { exit_code: Option<i32> },
    Missing,
    Foreign,
    Ambiguous,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CleanupKillResult {
    Killed,
    AlreadyMissing,
    Foreign,
    Ambiguous,
    Unconfirmed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeInventory {
    Available(Vec<InventoryEntry>),
    Unavailable,
}

/// One runtime listing taken at a single instant. A whole reconciliation pass
/// is judged against it, so the pass costs one `list-sessions` rather than one
/// per recorded row.
pub struct RuntimeSnapshot(Option<TmuxSnapshot>);

impl RuntimeSnapshot {
    /// A pass that could not read the runtime at all. Every row it is asked
    /// about is `Unavailable`, exactly as a failed per-row `inspect` is today.
    pub fn unavailable() -> Self {
        Self(None)
    }

    pub(crate) fn inventory(&self) -> RuntimeInventory {
        match self.0.as_ref().map(TmuxSnapshot::classified_inventory) {
            Some(Ok(entries)) => RuntimeInventory::Available(entries),
            Some(Err(_)) | None => RuntimeInventory::Unavailable,
        }
    }

    /// The judgement [`TerminalCleanupRuntime::inspect`] makes, answered from
    /// this listing instead of a fresh tmux process. The refusal order matches
    /// `inspect`: a row that cannot name its own runtime is ambiguous whether
    /// or not tmux answered.
    pub(crate) fn observe(&self, terminal: &session::Model) -> CleanupRuntimeObservation {
        if !PersistedSessionName::records(&terminal.tmux_session_name, &terminal.agent_run_id) {
            return CleanupRuntimeObservation::Ambiguous;
        }
        let Some(namespace) = terminal.runtime_namespace.as_deref() else {
            return CleanupRuntimeObservation::Ambiguous;
        };
        let Some(sessions) = self.0.as_ref() else {
            return CleanupRuntimeObservation::Unavailable;
        };
        match RuntimeIdentity::new(&terminal.agent_run_id, namespace) {
            Ok(identity) => map_observation(sessions.observe(&identity)),
            Err(_) => CleanupRuntimeObservation::Ambiguous,
        }
    }
}

#[async_trait]
pub trait TerminalCleanupRuntime: Send + Sync {
    async fn inspect(&self, terminal: &session::Model) -> CleanupRuntimeObservation;
    async fn kill_verified(&self, terminal: &session::Model) -> CleanupKillResult;

    async fn inventory(&self) -> RuntimeInventory {
        RuntimeInventory::Unavailable
    }

    /// One listing for a whole reconciliation pass. A runtime that returns
    /// `None` is asked row by row, as before.
    async fn snapshot(&self) -> Option<RuntimeSnapshot> {
        None
    }
}

#[derive(Clone, Default)]
pub struct TmuxCleanupRuntime;

impl TmuxCleanupRuntime {
    fn adapter_and_identity(
        terminal: &session::Model,
    ) -> Result<(TmuxAdapter, RuntimeIdentity), CleanupRuntimeObservation> {
        if !PersistedSessionName::records(&terminal.tmux_session_name, &terminal.agent_run_id) {
            return Err(CleanupRuntimeObservation::Ambiguous);
        }
        let namespace = terminal
            .runtime_namespace
            .as_deref()
            .ok_or(CleanupRuntimeObservation::Ambiguous)?;
        let adapter =
            TmuxAdapter::discover().map_err(|_| CleanupRuntimeObservation::Unavailable)?;
        let identity = RuntimeIdentity::new(&terminal.agent_run_id, namespace)
            .map_err(|_| CleanupRuntimeObservation::Ambiguous)?;
        Ok((adapter, identity))
    }
}

#[async_trait]
impl TerminalCleanupRuntime for TmuxCleanupRuntime {
    async fn inspect(&self, terminal: &session::Model) -> CleanupRuntimeObservation {
        let (adapter, identity) = match Self::adapter_and_identity(terminal) {
            Ok(value) => value,
            Err(observation) => return observation,
        };
        map_observation(adapter.observe(&identity))
    }

    async fn kill_verified(&self, terminal: &session::Model) -> CleanupKillResult {
        let (adapter, identity) = match Self::adapter_and_identity(terminal) {
            Ok(value) => value,
            Err(observation) => {
                return match observation {
                    CleanupRuntimeObservation::Ambiguous => CleanupKillResult::Ambiguous,
                    _ => CleanupKillResult::Unconfirmed,
                }
            }
        };
        match adapter.kill_verified(&identity) {
            Ok(KillOutcome::Killed) => CleanupKillResult::Killed,
            Ok(KillOutcome::AlreadyMissing) => CleanupKillResult::AlreadyMissing,
            Ok(KillOutcome::Refused(RuntimeObservation::Foreign)) => CleanupKillResult::Foreign,
            Ok(KillOutcome::Refused(RuntimeObservation::Ambiguous)) => CleanupKillResult::Ambiguous,
            Ok(KillOutcome::Refused(_)) | Err(_) => CleanupKillResult::Unconfirmed,
        }
    }

    async fn inventory(&self) -> RuntimeInventory {
        match TmuxAdapter::discover().and_then(|adapter| adapter.classified_inventory()) {
            Ok(entries) => RuntimeInventory::Available(entries),
            Err(_) => RuntimeInventory::Unavailable,
        }
    }

    async fn snapshot(&self) -> Option<RuntimeSnapshot> {
        Some(RuntimeSnapshot(
            TmuxAdapter::discover()
                .and_then(|adapter| adapter.snapshot())
                .ok(),
        ))
    }
}

fn map_observation(value: RuntimeObservation) -> CleanupRuntimeObservation {
    match value {
        RuntimeObservation::Running => CleanupRuntimeObservation::Running,
        RuntimeObservation::Exited { exit_code } => CleanupRuntimeObservation::Exited { exit_code },
        RuntimeObservation::Missing => CleanupRuntimeObservation::Missing,
        RuntimeObservation::Foreign => CleanupRuntimeObservation::Foreign,
        RuntimeObservation::Ambiguous => CleanupRuntimeObservation::Ambiguous,
        RuntimeObservation::Unavailable { .. } => CleanupRuntimeObservation::Unavailable,
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    use crate::tmux_adapter::TmuxSnapshot;

    const NAMESPACE: &str = "desktop";

    /// One listing holding every shape a recorded row can be judged against.
    fn listing() -> RuntimeSnapshot {
        RuntimeSnapshot(Some(TmuxSnapshot::from_listing(&[
            "pt-live\tticketry-v1\tlive\tdesktop\t1\t0\t",
            "pt-dead\tticketry-v1\tdead\tdesktop\t1\t1\t17",
            "pt-tombstoned\tticketry-v1\ttombstoned\tdesktop\t1\t0\t",
            "pt-elsewhere\tticketry-v1\telsewhere\tother-namespace\t1\t0\t",
            "pt-twinned\tticketry-v1\ttwinned\tdesktop\t1\t0\t",
            "other-name-for-twinned\tticketry-v1\ttwinned\tdesktop\t1\t0\t",
        ])))
    }

    fn row(agent_run_id: &str, namespace: Option<&str>) -> session::Model {
        let tmux_session_name = PersistedSessionName::for_agent_run(agent_run_id)
            .unwrap()
            .into_string();
        session::Model {
            agent_run_id: agent_run_id.to_owned(),
            tmux_session_name,
            task_id: "task".to_owned(),
            module_id: "module".to_owned(),
            project_id: "project".to_owned(),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            terminated_at: None,
            scope: "task".to_owned(),
            doc_rel_path: None,
            runtime_cleanup_pending: false,
            runtime_namespace: namespace.map(str::to_owned),
            output_identity: None,
            output_sequence: 0,
            last_output_at: None,
            agent: None,
        }
    }

    #[test]
    fn one_listing_answers_every_observation_kind_a_row_can_have() {
        let snapshot = listing();

        for (agent_run_id, expected) in [
            ("live", CleanupRuntimeObservation::Running),
            (
                "dead",
                CleanupRuntimeObservation::Exited {
                    exit_code: Some(17),
                },
            ),
            ("tombstoned", CleanupRuntimeObservation::Running),
            ("absent", CleanupRuntimeObservation::Missing),
            ("elsewhere", CleanupRuntimeObservation::Foreign),
            ("twinned", CleanupRuntimeObservation::Ambiguous),
        ] {
            assert_eq!(
                snapshot.observe(&row(agent_run_id, Some(NAMESPACE))),
                expected,
                "{agent_run_id}"
            );
        }
    }

    #[test]
    fn a_row_that_cannot_name_its_own_runtime_stays_ambiguous() {
        let snapshot = listing();
        let mut renamed = row("live", Some(NAMESPACE));
        renamed.tmux_session_name = "pt-someone-else".to_owned();

        assert_eq!(
            snapshot.observe(&renamed),
            CleanupRuntimeObservation::Ambiguous
        );
        assert_eq!(
            snapshot.observe(&row("live", None)),
            CleanupRuntimeObservation::Ambiguous
        );
        assert_eq!(
            snapshot.observe(&row("live", Some("not a namespace"))),
            CleanupRuntimeObservation::Ambiguous
        );
    }

    /// A runtime that could not be read judges every row exactly as a failed
    /// per-row `inspect` does, and still refuses a row it cannot name.
    #[test]
    fn an_unreadable_runtime_leaves_every_nameable_row_unavailable() {
        let snapshot = RuntimeSnapshot::unavailable();

        assert_eq!(
            snapshot.observe(&row("live", Some(NAMESPACE))),
            CleanupRuntimeObservation::Unavailable
        );
        assert_eq!(
            snapshot.observe(&row("live", None)),
            CleanupRuntimeObservation::Ambiguous
        );
        assert!(matches!(
            snapshot.inventory(),
            RuntimeInventory::Unavailable
        ));
    }
}
