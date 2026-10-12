use std::{env, future::Future};

use tauri_graphql::TransportApiImpl;
use ticketry_planner::{PlannerEndpoint, PlannerFrontendOrigin, PlannerService};
use tokio::sync::mpsc;

/// The adapter's planner listener, absent in editions without sprint planning.
pub(super) struct BrowserPlanner(Option<PlannerService>);

impl BrowserPlanner {
    pub(super) fn endpoint(&self) -> Option<&PlannerEndpoint> {
        self.0.as_ref().map(PlannerService::endpoint)
    }
}

/// Failures the planner listener reports; an absent planner never reports one.
pub(super) struct PlannerFailures(Option<mpsc::UnboundedReceiver<String>>);

impl PlannerFailures {
    pub(super) async fn failed(&mut self) -> Option<String> {
        match self.0.as_mut() {
            Some(failures) => failures.recv().await,
            None => std::future::pending().await,
        }
    }
}

/// Open the planner listener where the edition grants sprint planning.
pub(super) async fn start(
    api: TransportApiImpl,
) -> Result<(BrowserPlanner, PlannerFailures), String> {
    if !ticketry_edition::has(ticketry_edition::EditionCapability::SprintPlanning) {
        return Ok((BrowserPlanner(None), PlannerFailures(None)));
    }
    let port = match env::var("TICKETRY_PLANNER_PORT") {
        Ok(port) => port
            .parse::<u16>()
            .map_err(|_| "TICKETRY_PLANNER_PORT must be a port between 0 and 65535".to_owned())?,
        Err(env::VarError::NotPresent) => 0,
        Err(_) => return Err("TICKETRY_PLANNER_PORT must contain a valid port".to_owned()),
    };
    let origin = match env::var("MUXED_DESKTOP_ORIGIN") {
        Ok(origin) => origin,
        Err(env::VarError::NotPresent) => {
            let port = match env::var("MUXED_FRONTEND_PORT") {
                Ok(port) => port,
                Err(env::VarError::NotPresent) => "5174".to_owned(),
                Err(_) => return Err("MUXED_FRONTEND_PORT must contain a valid port".to_owned()),
            };
            format!("http://127.0.0.1:{port}")
        }
        Err(_) => {
            return Err("MUXED_DESKTOP_ORIGIN must contain a valid frontend origin".to_owned())
        }
    };
    let origin = PlannerFrontendOrigin::parse(&origin)?;
    let (failure, failed) = mpsc::unbounded_channel();
    let runtime = PlannerService::start(api, port, Some(origin), move |message| {
        let _ = failure.send(message);
    })
    .await?;
    Ok((BrowserPlanner(Some(runtime)), PlannerFailures(Some(failed))))
}

pub(super) async fn serve(
    planner: BrowserPlanner,
    server: impl Future<Output = std::io::Result<()>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let result = server.await;
    if let Some(runtime) = planner.0 {
        runtime.shutdown().await?;
    }
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use async_graphql::dynamic::{Field, FieldFuture, FieldValue, Object, Schema, TypeRef};
    use tauri_graphql::GraphQlEndpoint;

    use super::*;

    #[tokio::test]
    async fn browser_adapter_opens_no_planner_without_sprint_planning() {
        if ticketry_edition::has(ticketry_edition::EditionCapability::SprintPlanning) {
            return;
        }
        let (planner, mut failures) = start(installed_api()).await.unwrap();
        assert!(planner.endpoint().is_none(), "Pocock opens no planner listener");
        let failure =
            tokio::time::timeout(std::time::Duration::from_millis(50), failures.failed()).await;
        assert!(failure.is_err(), "an absent planner never reports a failure");
        serve(planner, async { Ok(()) }).await.unwrap();
    }

    fn installed_api() -> TransportApiImpl {
        let query = Object::new("Query").field(Field::new(
            "ready",
            TypeRef::named_nn(TypeRef::BOOLEAN),
            |_| FieldFuture::new(async { Ok(Some(FieldValue::value(true))) }),
        ));
        let api = TransportApiImpl::new();
        api.install_endpoint(GraphQlEndpoint::new(
            Schema::build("Query", None, None)
                .register(query)
                .finish()
                .unwrap(),
        ))
        .unwrap();
        api
    }

    #[tokio::test]
    async fn browser_planner_serves_the_installed_schema_and_joins_shutdown_on_server_failure() {
        if !ticketry_edition::has(ticketry_edition::EditionCapability::SprintPlanning) {
            return;
        }
        let (runtime, _failures) = start(installed_api()).await.unwrap();
        let endpoint = runtime.endpoint().expect("core opens the planner").clone();
        let origin = env::var("MUXED_DESKTOP_ORIGIN").unwrap_or_else(|_| {
            format!(
                "http://127.0.0.1:{}",
                env::var("MUXED_FRONTEND_PORT").unwrap_or_else(|_| "5174".to_owned())
            )
        });
        let preflight = reqwest::Client::new()
            .request(reqwest::Method::OPTIONS, &endpoint.graphql_url)
            .header("Origin", &origin)
            .header("Access-Control-Request-Method", "POST")
            .send()
            .await
            .unwrap();
        assert_eq!(preflight.status(), reqwest::StatusCode::NO_CONTENT);
        assert_eq!(preflight.headers()["access-control-allow-origin"], origin);
        let response = reqwest::Client::new()
            .post(&endpoint.graphql_url)
            .header("Origin", &origin)
            .bearer_auth(&endpoint.bearer_token)
            .json(&serde_json::json!({"query": "{ ready }"}))
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap(),
            serde_json::json!({"data": {"ready": true}})
        );
        let port = reqwest::Url::parse(&endpoint.graphql_url)
            .unwrap()
            .port()
            .unwrap();
        let error = serve(runtime, async {
            Err(std::io::Error::other("server failed"))
        })
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "server failed");
        let _rebound = tokio::net::TcpListener::bind(("127.0.0.1", port))
            .await
            .unwrap();
    }
}
