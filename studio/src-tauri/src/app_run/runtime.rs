use std::collections::BTreeMap;
use std::path::PathBuf;

use async_trait::async_trait;

use crate::tmux_adapter::{
    ApprovedArgv, CreateOutcome, CreateSession, InventoryEntry, KillOutcome, RuntimeIdentity,
    RuntimeObservation, TerminalGeometry, TmuxAdapter,
};

use super::AppRunError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppRunLaunch {
    pub run_id: String,
    pub command: String,
    pub working_directory: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub columns: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppRunObservation {
    pub runtime_namespace: String,
    pub live: bool,
}

#[async_trait]
pub trait AppRunRuntime: Send + Sync {
    async fn inspect(&self, run_id: &str) -> Result<Option<AppRunObservation>, AppRunError>;
    async fn start(&self, launch: AppRunLaunch) -> Result<(), AppRunError>;
    async fn stop(&self, run_id: &str, runtime_namespace: &str) -> Result<(), AppRunError>;
}

#[derive(Clone, Default)]
pub struct TmuxAppRunRuntime;

#[async_trait]
impl AppRunRuntime for TmuxAppRunRuntime {
    async fn inspect(&self, run_id: &str) -> Result<Option<AppRunObservation>, AppRunError> {
        let run_id = run_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let matches = TmuxAdapter::discover()?
                .classified_inventory()?
                .into_iter()
                .filter_map(|entry| match entry {
                    InventoryEntry::Owned { session, .. } if session.agent_run_id == run_id => {
                        Some(AppRunObservation {
                            runtime_namespace: session.runtime_namespace,
                            live: session.running,
                        })
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            match matches.as_slice() {
                [] => Ok(None),
                [one] => Ok(Some(one.clone())),
                _ => Err(AppRunError::conflict(
                    "More than one tmux session claims this App run.",
                )),
            }
        })
        .await
        .map_err(|error| AppRunError::runtime(error.to_string()))?
    }

    async fn start(&self, launch: AppRunLaunch) -> Result<(), AppRunError> {
        tokio::task::spawn_blocking(move || {
            let runtime_namespace = crate::tmux_adapter::current_runtime_namespace()?;
            let identity = RuntimeIdentity::new(&launch.run_id, &runtime_namespace)?;
            let command = ApprovedArgv::for_app_command(
                app_shell(),
                launch.command,
                launch.working_directory,
                launch.environment,
            )?;
            let outcome = TmuxAdapter::discover()?.create(&CreateSession {
                identity,
                geometry: TerminalGeometry::new(launch.columns, launch.rows)?,
                command,
            })?;
            match outcome {
                CreateOutcome::Created | CreateOutcome::Existing(RuntimeObservation::Running) => {
                    Ok(())
                }
                CreateOutcome::Existing(observation) => Err(AppRunError::conflict(format!(
                    "The App run identity is unavailable: {observation:?}."
                ))),
            }
        })
        .await
        .map_err(|error| AppRunError::runtime(error.to_string()))?
    }

    async fn stop(&self, run_id: &str, runtime_namespace: &str) -> Result<(), AppRunError> {
        let run_id = run_id.to_owned();
        let runtime_namespace = runtime_namespace.to_owned();
        tokio::task::spawn_blocking(move || {
            let identity = RuntimeIdentity::new(&run_id, &runtime_namespace)?;
            match TmuxAdapter::discover()?.kill_verified(&identity)? {
                KillOutcome::Killed | KillOutcome::AlreadyMissing => Ok(()),
                KillOutcome::Refused(observation) => Err(AppRunError::conflict(format!(
                    "The App run could not be verified for Stop: {observation:?}."
                ))),
            }
        })
        .await
        .map_err(|error| AppRunError::runtime(error.to_string()))?
    }
}

fn app_shell() -> PathBuf {
    std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/sh"))
}

impl From<crate::tmux_adapter::TmuxAdapterError> for AppRunError {
    fn from(error: crate::tmux_adapter::TmuxAdapterError) -> Self {
        Self::runtime(error.to_string())
    }
}
