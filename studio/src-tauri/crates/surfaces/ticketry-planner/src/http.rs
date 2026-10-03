use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use tauri_graphql::{TransportApi, TransportApiImpl};

use crate::PlannerEndpoint;

#[derive(Clone)]
struct PlannerHttp {
    api: TransportApiImpl,
    host: String,
    authorization: String,
}

pub(crate) fn router(api: TransportApiImpl, endpoint: &PlannerEndpoint, host: String) -> Router {
    let state = PlannerHttp {
        api,
        host,
        authorization: format!("Bearer {}", endpoint.bearer_token),
    };
    Router::new()
        .route("/graphql", post(execute).options(preflight))
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), admit))
        .with_state(state)
}

async fn admit(State(state): State<PlannerHttp>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    if !local_request(headers, &state.host) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match *request.method() {
        Method::POST => {
            if header_value(headers, header::AUTHORIZATION) != Some(state.authorization.as_str()) {
                return StatusCode::FORBIDDEN.into_response();
            }
            if !header_value(headers, header::CONTENT_TYPE).is_some_and(|value| {
                value
                    .split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
            }) {
                return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
            }
        }
        Method::OPTIONS => {
            if header_value(headers, header::ORIGIN).is_none()
                || header_value(headers, header::ACCESS_CONTROL_REQUEST_METHOD) != Some("POST")
            {
                return StatusCode::FORBIDDEN.into_response();
            }
        }
        _ => return StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
    let origin = headers.get(header::ORIGIN).cloned();
    let mut response = next.run(request).await;
    if let Some(origin) = origin {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response
}

async fn execute(State(state): State<PlannerHttp>, body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        state.api.graphql_execute(body).await,
    )
        .into_response()
}

async fn preflight() -> Response {
    (
        [
            (header::ACCESS_CONTROL_ALLOW_METHODS, "POST"),
            (
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                "authorization, content-type",
            ),
        ],
        StatusCode::NO_CONTENT,
    )
        .into_response()
}

fn header_value(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn local_request(headers: &HeaderMap, host: &str) -> bool {
    if header_value(headers, header::HOST) != Some(host) {
        return false;
    }
    match headers.get(header::ORIGIN) {
        None => true,
        Some(origin) => origin.to_str().is_ok_and(|origin| {
            matches!(
                origin,
                "tauri://localhost"
                    | "http://tauri.localhost"
                    | "https://tauri.localhost"
                    | "http://127.0.0.1:5174"
            ) || origin == format!("http://{host}")
        }),
    }
}
