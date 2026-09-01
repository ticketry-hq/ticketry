use async_graphql::{dynamic::Schema, Request, Response, Variables};
use futures_util::{Stream, StreamExt};
use serde::Deserialize;

pub(crate) const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct GraphQlEndpoint {
    schema: Schema,
}

impl GraphQlEndpoint {
    pub fn new(schema: Schema) -> Self {
        Self { schema }
    }

    pub async fn execute_json(&self, request_json: &str) -> String {
        let request = match wire_request(request_json) {
            Ok(request) => request,
            Err(response) => return response,
        };
        encode_response(&self.schema.execute(request).await)
    }

    pub fn execute_stream_json(
        &self,
        request_json: &str,
    ) -> Result<impl Stream<Item = String> + Send + 'static, String> {
        let request = wire_request(request_json)?;
        Ok(self
            .schema
            .execute_stream(request)
            .map(|response| encode_response(&response)))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireRequest {
    query: String,
    operation_name: Option<String>,
    variables: Option<serde_json::Value>,
}

fn wire_request(request_json: &str) -> Result<Request, String> {
    if request_json.len() > MAX_REQUEST_BYTES {
        return Err(error_response(
            "The GraphQL transport request is too large.",
            "payload_too_large",
            "the encoded request exceeds one MiB",
        ));
    }

    let wire = serde_json::from_str::<WireRequest>(request_json).map_err(|error| {
        error_response(
            "The GraphQL transport request is invalid.",
            "bad_request",
            &error.to_string(),
        )
    })?;
    if wire.query.trim().is_empty() {
        return Err(error_response(
            "The GraphQL query is empty.",
            "bad_request",
            "query must contain an operation",
        ));
    }

    let mut request = Request::new(wire.query);
    if let Some(operation_name) = wire.operation_name {
        request = request.operation_name(operation_name);
    }
    if let Some(variables) = wire.variables {
        request = request.variables(Variables::from_json(variables));
    }
    Ok(request)
}

fn encode_response(response: &Response) -> String {
    serde_json::to_string(response).unwrap_or_else(|error| {
        error_response(
            "The GraphQL response could not be encoded.",
            "internal",
            &error.to_string(),
        )
    })
}

pub(crate) fn error_response(message: &str, code: &str, detail: &str) -> String {
    serde_json::json!({
        "data": null,
        "errors": [{
            "message": message,
            "extensions": { "code": code, "detail": detail }
        }]
    })
    .to_string()
}

pub(crate) fn service_unavailable_response() -> String {
    error_response(
        "Application services are not ready.",
        "service_unavailable",
        "the GraphQL endpoint is installed during Tauri setup",
    )
}
