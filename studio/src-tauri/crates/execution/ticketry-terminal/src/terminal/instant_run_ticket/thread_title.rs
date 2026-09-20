use std::{
    path::Path,
    sync::{Arc, OnceLock},
};

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use ticketry_codex_app_server::{CodexAppServerClient, CodexAppServerError, CodexThreadTitles};
use ticketry_entities::{agent_run, launch_material};
use ticketry_launch::{provider_contract, Provider};
use ticketry_tool_discovery::SupportedTool;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct InstantRunTicketTitleService {
    database: DatabaseConnection,
    reader: Arc<OnceLock<Arc<dyn CodexThreadTitles>>>,
    restarts: Option<Arc<broadcast::Sender<()>>>,
}

impl InstantRunTicketTitleService {
    pub async fn start(
        database: DatabaseConnection,
        executable: impl AsRef<Path>,
    ) -> Result<Self, CodexAppServerError> {
        let client = CodexAppServerClient::start(executable).await?;
        Ok(Self::with_client(database, client))
    }

    pub fn production(database: DatabaseConnection) -> Self {
        let service = Self::waiting(database);
        let reader = Arc::downgrade(&service.reader);
        let restarts = Arc::downgrade(service.restarts.as_ref().expect("restart sender"));
        tokio::spawn(async move {
            let executable = match tokio::task::spawn_blocking(|| {
                crate::approved_tool_path(SupportedTool::Codex)
            })
            .await
            {
                Ok(Ok(executable)) => executable,
                _ => return,
            };
            let Ok(client) = CodexAppServerClient::start(executable).await else {
                return;
            };
            let client_restarts = client.subscribe_restarts();
            let Some(reader) = reader.upgrade() else {
                return;
            };
            let Some(restarts) = restarts.upgrade() else {
                return;
            };
            if reader.set(Arc::new(client)).is_err() {
                return;
            }
            let _ = restarts.send(());
            drop(reader);
            forward_restarts(client_restarts, restarts).await;
        });
        service
    }

    pub fn new(database: DatabaseConnection, reader: Arc<dyn CodexThreadTitles>) -> Self {
        let slot = OnceLock::new();
        assert!(slot.set(reader).is_ok(), "new title reader slot is empty");
        Self {
            database,
            reader: Arc::new(slot),
            restarts: None,
        }
    }

    /// Rename a Codex thread through the one resident app-server this service
    /// already reads titles from. Callers validate their own arguments; this
    /// only reports that the resident capability is missing.
    pub async fn rename_thread(
        &self,
        thread_id: &str,
        name: &str,
    ) -> Result<(), CodexAppServerError> {
        let Some(titles) = self.reader.get() else {
            return Err(CodexAppServerError::unavailable(
                "the codex app-server is not running",
            ));
        };
        titles.set_thread_title(thread_id, name).await
    }

    pub(super) fn subscribe_restarts(&self) -> Option<tokio::sync::broadcast::Receiver<()>> {
        self.restarts.as_ref().map(|restarts| restarts.subscribe())
    }

    pub async fn resolve(&self, agent_run_id: &str) -> Result<Option<String>, sea_orm::DbErr> {
        let Some((material, Some(run))) = launch_material::Entity::find()
            .find_also_related(agent_run::Entity)
            .filter(launch_material::Column::AgentRunId.eq(agent_run_id))
            .filter(agent_run::Column::Agent.eq(provider_contract(Provider::Codex).slug))
            .filter(agent_run::Column::Scope.eq("instant"))
            .filter(agent_run::Column::EndedAt.is_null())
            .one(&self.database)
            .await?
        else {
            return Ok(None);
        };
        let Some(thread_id) = run
            .provider_session_id
            .as_deref()
            .map(str::trim)
            .filter(|thread_id| !thread_id.is_empty())
        else {
            return Ok(None);
        };

        let Some(reader) = self.reader.get() else {
            return Ok(None);
        };
        let Ok(Some(name)) = reader.read_thread_title(thread_id).await else {
            return Ok(None);
        };
        let name = name.trim();
        let normalized_name = normalize_whitespace(name);
        let normalized_prompt =
            normalize_whitespace(material.prompt.as_deref().unwrap_or_default());
        Ok(
            (!normalized_name.is_empty() && !normalized_prompt.starts_with(&normalized_name))
                .then(|| name.to_owned()),
        )
    }

    fn waiting(database: DatabaseConnection) -> Self {
        Self {
            database,
            reader: Arc::new(OnceLock::new()),
            restarts: Some(Arc::new(broadcast::channel(1).0)),
        }
    }

    fn with_client(database: DatabaseConnection, client: CodexAppServerClient) -> Self {
        let service = Self::waiting(database);
        let client_restarts = client.subscribe_restarts();
        assert!(
            service.reader.set(Arc::new(client)).is_ok(),
            "new title reader slot is empty"
        );
        let restarts = service.restarts.as_ref().expect("restart sender").clone();
        tokio::spawn(forward_restarts(client_restarts, restarts));
        service
    }
}

async fn forward_restarts(mut source: broadcast::Receiver<()>, target: Arc<broadcast::Sender<()>>) {
    loop {
        match source.recv().await {
            Ok(()) | Err(broadcast::error::RecvError::Lagged(_)) => {
                let _ = target.send(());
            }
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
