use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use tauri_graphql::{TransportApi, TransportApiImpl};

#[derive(Clone)]
struct AdapterState {
    api: TransportApiImpl,
    documents: muxed_studio_lib::documents::DocumentsService,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data_directory = std::env::var_os("MUXED_DATA_DIR")
        .map(PathBuf::from)
        .ok_or("MUXED_DATA_DIR is required")?;
    std::fs::create_dir_all(&data_directory)?;
    let api = TransportApiImpl::new();
    let adopted = muxed_studio_lib::graphql_foundation::adopt_worktracker_and_install(
        &data_directory.join("rust-core.sqlite3"),
        &data_directory,
        &api,
        muxed_studio_lib::graphql_foundation::InstallationOwnership::Owned,
    ).await.map_err(|error| error.message)?;
    // This development-only process completes the adoption synchronously and
    // has no desktop lifecycle available to publish the command gate.
    muxed_studio_lib::settings_persistence::publish_readiness(
        &data_directory,
        &muxed_studio_lib::settings_persistence::Slice2Readiness::complete(),
    )?;
    muxed_studio_lib::workspace_handoff::publish_readiness(
        &data_directory,
        &muxed_studio_lib::workspace_handoff::Slice4Readiness::complete(),
    )?;
    let port = std::env::var("TICKETRY_GRAPHQL_ADAPTER_PORT")
        .unwrap_or_else(|_| "8790".to_owned())
        .parse::<u16>()?;
    let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await?;
    let state = AdapterState {
        api,
        documents: adopted.runtime.documents().clone(),
    };
    let app = Router::new()
        .route("/graphql", post(execute))
        .route("/documents/{document_id}/{*asset_path}", get(document))
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn execute(State(state): State<AdapterState>, request: String) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/json")],
        state.api.graphql_execute(request).await,
    )
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
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    if let Some(etag) = asset.etag.and_then(|value| HeaderValue::from_str(&value).ok()) {
        response.headers_mut().insert(header::ETAG, etag);
    }
    response
}
