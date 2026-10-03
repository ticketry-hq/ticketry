use std::{env, future::Future};

use tauri_graphql::TransportApiImpl;
use ticketry_planner::{PlannerFrontendOrigin, PlannerService};
use tokio::sync::mpsc;

pub(super) async fn start(
    api: TransportApiImpl,
) -> Result<(PlannerService, mpsc::UnboundedReceiver<String>), String> {
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
    Ok((runtime, failed))
}

pub(super) async fn serve(
    runtime: PlannerService,
    server: impl Future<Output = std::io::Result<()>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let result = server.await;
    runtime.shutdown().await?;
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use async_graphql::dynamic::{Field, FieldFuture, FieldValue, Object, Schema, TypeRef};
    use tauri_graphql::GraphQlEndpoint;

    use super::*;

    #[tokio::test]
    async fn browser_planner_serves_the_installed_schema_and_joins_shutdown_on_server_failure() {
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
        let (runtime, _failed) = start(api).await.unwrap();
        let endpoint = runtime.endpoint().clone();
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
