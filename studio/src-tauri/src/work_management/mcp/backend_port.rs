use http::request::Parts;
use reqwest::{Client, Method, StatusCode};
use rmcp::{service::RequestContext, RoleServer};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Clone)]
pub struct BackendPort {
    client: Client,
    base_url: String,
    api_key: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct RunPrincipal {
    pub agent_run_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub scope: String,
}

#[derive(Debug)]
pub struct AuthorizationFailure(pub Value);

impl BackendPort {
    pub fn new(base_url: String, api_key: String) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key,
        }
    }

    pub async fn authorize(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Result<(RunPrincipal, String), AuthorizationFailure> {
        let authorization = request_authorization(context).ok_or_else(|| {
            AuthorizationFailure(json!({
                "ok": false,
                "error": "caller_run_unbound",
                "reason": "authorization_missing"
            }))
        })?;
        let response = self
            .request(
                Method::POST,
                "/runs/mcp-authorize",
                Some(&authorization),
                None,
            )
            .await
            .map_err(AuthorizationFailure)?;
        serde_json::from_value(response)
            .map(|principal| (principal, authorization))
            .map_err(|_| {
                AuthorizationFailure(json!({
                    "ok": false,
                    "error": "run_control_invalid_response"
                }))
            })
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        authorization: Option<&str>,
        body: Option<Value>,
    ) -> Result<Value, Value> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base_url))
            .header("x-api-key", &self.api_key);
        if let Some(authorization) = authorization {
            request = request.header("Authorization", authorization);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|_| json!({"ok": false, "error": "run_control_unavailable"}))?;
        let status = response.status();
        let body = response.json::<Value>().await.unwrap_or_else(|_| {
            json!({"ok": false, "error": "run_control_invalid_response", "status_code": status.as_u16()})
        });
        if status.is_success() {
            Ok(body)
        } else {
            Err(normalize_authorization_error(status, body))
        }
    }
}

fn request_authorization(context: &RequestContext<RoleServer>) -> Option<String> {
    context
        .extensions
        .get::<Parts>()
        .and_then(|parts| parts.headers.get("authorization"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn normalize_authorization_error(status: StatusCode, body: Value) -> Value {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::NOT_FOUND {
        let reason = body
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or("authorization_invalid");
        return json!({
            "ok": false,
            "error": body.get("code").and_then(Value::as_str).unwrap_or("caller_run_unbound"),
            "reason": reason
        });
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_errors_keep_the_established_envelope() {
        let body = normalize_authorization_error(
            StatusCode::UNAUTHORIZED,
            json!({"detail": "authorization_expired", "code": "caller_run_unbound"}),
        );
        assert_eq!(body["error"], "caller_run_unbound");
        assert_eq!(body["reason"], "authorization_expired");
    }

    #[test]
    fn backend_port_has_no_graph_run_execution_route() {
        let source = include_str!("backend_port.rs");
        assert!(!source.contains(concat!("/", "graph-run")));
        assert!(!source.contains(concat!("reset_", "dependency_graph")));
    }
}
