use std::{
    net::Ipv4Addr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use tauri_graphql::{TransportApi, TransportApiImpl};
use tokio::{sync::oneshot, task::JoinHandle};

use crate::{http, PlannerEndpoint};

/// One listener owned by one Ticketry process. Start after schema installation;
/// join shutdown before releasing Ticketry's data-directory ownership.
pub struct PlannerService {
    endpoint: PlannerEndpoint,
    runtime: tokio::runtime::Handle,
    stopping: Arc<AtomicBool>,
    stop: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<Result<(), std::io::Error>>>,
}

impl PlannerService {
    /// Port zero asks the OS for an available port. A nonzero port must bind
    /// exactly or startup fails. Unexpected listener failure reaches the desktop
    /// health publisher supplied by the owning process.
    pub async fn start(
        api: TransportApiImpl,
        port: u16,
        on_failure: impl Fn(String) + Send + 'static,
    ) -> Result<Self, String> {
        let response = api
            .clone()
            .graphql_execute(r#"{"query":"{ __typename }"}"#.to_owned())
            .await;
        let ready = serde_json::from_str::<serde_json::Value>(&response)
            .ok()
            .is_some_and(|response| {
                response["data"]["__typename"].is_string()
                    && response
                        .get("errors")
                        .is_none_or(|errors| errors.as_array().is_some_and(Vec::is_empty))
            });
        if !ready {
            return Err(
                "Ticketry planner cannot start before its authoritative GraphQL endpoint is ready"
                    .to_owned(),
            );
        }
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|error| {
                format!("Ticketry planner could not bind 127.0.0.1:{port}: {error}")
            })?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("Ticketry planner endpoint is unavailable: {error}"))?;
        let endpoint = PlannerEndpoint {
            graphql_url: format!("http://{address}/graphql"),
            bearer_token: uuid::Uuid::new_v4().simple().to_string(),
        };
        let app = http::router(api, &endpoint, address.to_string());
        let (stop, stopped) = oneshot::channel();
        let stopping = Arc::new(AtomicBool::new(false));
        let service_stopping = stopping.clone();
        let task = tokio::spawn(async move {
            let result = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await;
            if !service_stopping.load(Ordering::Acquire) {
                let message = match &result {
                    Ok(()) => "Ticketry planner listener stopped unexpectedly".to_owned(),
                    Err(error) => format!("Ticketry planner listener failed: {error}"),
                };
                on_failure(message);
            }
            result
        });
        Ok(Self {
            endpoint,
            runtime: tokio::runtime::Handle::current(),
            stopping,
            stop: Some(stop),
            task: Some(task),
        })
    }

    pub fn endpoint(&self) -> &PlannerEndpoint {
        &self.endpoint
    }

    pub async fn shutdown(mut self) -> Result<(), String> {
        self.signal_stop();
        if let Some(task) = self.task.take() {
            join(task).await?;
        }
        Ok(())
    }

    fn signal_stop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

impl Drop for PlannerService {
    fn drop(&mut self) {
        self.signal_stop();
        if let Some(task) = self.task.take() {
            self.runtime.spawn(async {
                let _ = join(task).await;
            });
        }
    }
}

async fn join(task: JoinHandle<Result<(), std::io::Error>>) -> Result<(), String> {
    task.await
        .map_err(|error| format!("Ticketry planner task failed: {error}"))?
        .map_err(|error| format!("Ticketry planner shutdown failed: {error}"))
}
