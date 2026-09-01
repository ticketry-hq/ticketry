use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Json, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::StreamExt;
use serde::Deserialize;
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_launch::LaunchPathsService;
use ticketry_mcp::{McpRuntime, RunAuthority};
use ticketry_terminal::TerminalRuntimeAuthority;

#[path = "ticketry_graphql_adapter/mcp.rs"]
mod mcp;

#[path = "ticketry_graphql_adapter/hook_runner.rs"]
mod hook_runner;

#[path = "ticketry_graphql_adapter/terminal_ws.rs"]
mod terminal_ws;

#[path = "ticketry_graphql_adapter/viewer_session.rs"]
mod viewer_session;

#[derive(Clone)]
struct AdapterState {
    api: TransportApiImpl,
    documents: ticketry_documents::DocumentsService,
    /// In-process MCP is retained for the adapter's whole process lifetime;
    /// dropping it would cancel the listener and its reconciler.
    #[allow(dead_code)]
    mcp: Arc<McpRuntime>,
    terminal: Arc<terminal_ws::TerminalBridge>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubscriptionRequest {
    subscription_id: String,
    request: String,
}

fn publish_development_readiness(
    data_directory: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    ticketry_settings::publish_readiness(
        data_directory,
        &ticketry_settings::Slice2Readiness::complete(),
    )?;
    ticketry_runs::publish_readiness(
        data_directory,
        &ticketry_runs::Slice3Readiness::complete(),
    )?;
    ticketry_workspace_runtime::handoff::publish_readiness(
        data_directory,
        &ticketry_workspace_runtime::handoff::Slice4Readiness::complete(),
    )?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data_directory = std::env::var_os("MUXED_DATA_DIR")
        .map(PathBuf::from)
        .ok_or("MUXED_DATA_DIR is required")?;
    std::fs::create_dir_all(&data_directory)?;
    // The desktop shell's `configure_file_logging` wrapper is not reachable
    // from here, so the adapter opens the same process log directly.
    let log_path = std::env::var_os("MUXED_DEVELOPMENT_LOG_PATH").map(PathBuf::from);
    ticketry_diagnostics::configure_process_file_log(log_path.is_some(), &data_directory, log_path);
    let _data_directory_guard =
        ticketry_data_directory::DataDirectoryGuard::acquire(&data_directory).map_err(|error| {
            format!(
                "could not own browser development data directory {}: {error}",
                data_directory.display()
            )
        })?;
    let api = TransportApiImpl::new();
    let adopted = ticketry_graphql_schema::adopt_worktracker_and_install(
        &data_directory.join("rust-core.sqlite3"),
        &data_directory,
        &api,
        ticketry_graphql_schema::InstallationOwnership::Owned,
    )
    .await
    .map_err(|error| error.message)?;
    // This development-only process completes the adoption synchronously and
    // has no desktop lifecycle available to publish the command gate.
    publish_development_readiness(&data_directory)?;

    // Browser GraphQL launches resolve agent-run launch material through the
    // same runtime authority the desktop shell configures, so hook spooling,
    // launch paths, and the run authority stay identical across runtimes.
    let hook_runner = hook_runner::HookRunnerResolver::from_environment().resolve()?;
    let database = adopted.runtime.commands().clone();
    let hook_spool_directory =
        ticketry_runs::ensure_hook_spool_directory(&data_directory)?;
    adopted
        .runtime
        .terminal_runtime()
        .configure(TerminalRuntimeAuthority {
            database: database.clone(),
            paths: LaunchPathsService::new(database.clone()),
            hook_runner,
            hook_spool_directory,
            mcp_url: String::new(),
            run_authority: RunAuthority::new(database.clone()),
            granted_operations: ticketry_mcp::allowed_provider_operations(),
        });

    let mcp_runtime = Arc::new(mcp::start(&data_directory).await?);
    eprintln!(
        "Ticketry WorkTracker MCP listening at http://{}/mcp",
        mcp_runtime.address()
    );
    adopted.runtime.terminal_runtime().replace_mcp_authority(
        format!("http://{}/mcp", mcp_runtime.address()),
        mcp_runtime.authority(),
    )?;

    let port = std::env::var("TICKETRY_GRAPHQL_ADAPTER_PORT")
        .unwrap_or_else(|_| "8790".to_owned())
        .parse::<u16>()?;
    let listener =
        tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await?;
    let state = AdapterState {
        api,
        documents: adopted.runtime.documents().clone(),
        mcp: mcp_runtime,
        terminal: Arc::new(terminal_ws::TerminalBridge::new(
            adopted.runtime.viewer_ownership().clone(),
        )),
    };
    let app = Router::new()
        .route("/graphql", post(execute))
        .route("/graphql/subscribe", post(subscribe))
        .route("/documents/{document_id}/{*asset_path}", get(document))
        .route("/ws/terminal", get(terminal_socket))
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn terminal_socket(
    State(state): State<AdapterState>,
    headers: axum::http::HeaderMap,
    upgrade: axum::extract::ws::WebSocketUpgrade,
) -> impl IntoResponse {
    // Before any upgrade, enforce the documented loopback boundary. There is
    // deliberately no wildcard CORS: a cross-origin page can never attach to
    // this machine's terminals.
    if let Err(reason) = local_request_gate(&headers) {
        return (StatusCode::FORBIDDEN, reason).into_response();
    }
    upgrade
        .on_upgrade(move |socket| {
            let terminal = state.terminal.clone();
            async move { terminal.accept(socket).await }
        })
        .into_response()
}

async fn subscribe(
    State(state): State<AdapterState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<SubscriptionRequest>,
) -> Response {
    if let Err(reason) = local_request_gate(&headers) {
        return (StatusCode::FORBIDDEN, reason).into_response();
    }
    if !tauri_graphql::valid_subscription_id(&request.subscription_id) {
        return (
            StatusCode::BAD_REQUEST,
            "The subscription id must use 1-128 ASCII letters, digits, hyphens, or underscores.",
        )
            .into_response();
    }
    let stream = match state.api.graphql_subscription_stream(&request.request) {
        Ok(stream) => stream,
        Err(response) => {
            return (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "application/json")],
                response,
            )
                .into_response();
        }
    };
    let body =
        Body::from_stream(stream.map(|frame| Ok::<_, Infallible>(format!("data: {frame}\n\n"))));
    let mut response = Response::new(body);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn execute(
    State(state): State<AdapterState>,
    headers: axum::http::HeaderMap,
    request: String,
) -> Response {
    if let Err(reason) = local_request_gate(&headers) {
        return (StatusCode::FORBIDDEN, reason).into_response();
    }
    (
        [(header::CONTENT_TYPE, "application/json")],
        state.api.graphql_execute(request).await,
    )
        .into_response()
}

fn local_request_gate(headers: &axum::http::HeaderMap) -> Result<(), &'static str> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    terminal_ws::loopback_gate(host, origin)
}

async fn document(
    State(state): State<AdapterState>,
    Path((document_id, asset_path)): Path<(String, String)>,
) -> Response {
    let Ok(Some(asset)) = state.documents.read_asset(&document_id, &asset_path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = Response::new(Body::from(asset.bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(asset.media_type),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(etag) = asset
        .etag
        .and_then(|value| HeaderValue::from_str(&value).ok())
    {
        response.headers_mut().insert(header::ETAG, etag);
    }
    response
}

#[cfg(test)]
mod tests {
    use axum::http::{header, HeaderMap, HeaderValue};

    use super::{local_request_gate, publish_development_readiness};

    #[test]
    fn browser_adapter_opens_every_composed_runtime_gate() {
        let directory = tempfile::tempdir().expect("create adapter data directory");

        publish_development_readiness(directory.path()).expect("publish development readiness");

        assert!(ticketry_settings::published_readiness_is_complete(
            directory.path(),
        ));
        assert!(ticketry_runs::published_readiness_is_complete(
            directory.path()
        ));
        assert!(
            ticketry_workspace_runtime::handoff::published_readiness_is_complete(
                directory.path()
            )
        );
    }

    #[test]
    fn graphql_control_requests_reject_non_loopback_browser_origins() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("127.0.0.1:8790"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://malicious.example"),
        );
        assert!(local_request_gate(&headers).is_err());

        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://localhost:5174"),
        );
        assert_eq!(local_request_gate(&headers), Ok(()));
    }
}
