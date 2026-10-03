use serde::Serialize;

/// Published only through Ticketry's local desktop configuration. The credential
/// belongs to this listener instance and is never persisted or written to logs.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerEndpoint {
    pub graphql_url: String,
    pub bearer_token: String,
}

impl std::fmt::Debug for PlannerEndpoint {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PlannerEndpoint")
            .field("graphql_url", &self.graphql_url)
            .field("bearer_token", &"[redacted]")
            .finish()
    }
}
