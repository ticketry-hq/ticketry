use std::time::Duration;

use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use tauri_graphql::{GraphQlEndpoint, TransportApi, TransportApiImpl};
use ticketry_planner::{PlannerEndpoint, PlannerService};
use ticketry_work_management::commands::CommandDatabase;

pub async fn start_planner(database: &DatabaseConnection) -> (PlannerService, TransportApiImpl) {
    // Same builder connection and authored-command connection. Adding a second
    // connection to context alone would not redirect generated Seaography reads.
    let schema = ticketry_graphql_schema::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(CommandDatabase(database.clone())),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let api = TransportApiImpl::new();
    api.install_endpoint(GraphQlEndpoint::new(schema)).unwrap();
    let planner = PlannerService::start(api.clone(), 0, |error| panic!("{error}"))
        .await
        .unwrap();
    (planner, api)
}

pub struct Client {
    http: reqwest::Client,
    endpoint: PlannerEndpoint,
}

impl Client {
    pub fn new(endpoint: &PlannerEndpoint) -> Self {
        Self {
            http: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap(),
            endpoint: endpoint.clone(),
        }
    }

    pub async fn response(&self, query: &str, variables: Value) -> Value {
        self.http
            .post(&self.endpoint.graphql_url)
            .bearer_auth(&self.endpoint.bearer_token)
            .json(&json!({"query": query, "variables": variables}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap()
    }

    pub async fn data(&self, query: &str, variables: Value) -> Value {
        let response = self.response(query, variables).await;
        assert!(
            response.get("errors").is_none(),
            "GraphQL failed: {response}"
        );
        response["data"].clone()
    }

    pub async fn assert_forbidden(&self, bearer: Option<&str>) {
        let mut request = self
            .http
            .post(&self.endpoint.graphql_url)
            .json(&json!({"query": "{ __typename }"}));
        if let Some(bearer) = bearer {
            request = request.bearer_auth(bearer);
        }
        assert_eq!(
            request.send().await.unwrap().status(),
            reqwest::StatusCode::FORBIDDEN
        );
    }
}

/// The same in-process transport used by the desktop, with no Tauri window.
pub async fn native_data(api: &TransportApiImpl, query: &str, variables: Value) -> Value {
    let response: Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(json!({"query": query, "variables": variables}).to_string())
            .await,
    )
    .unwrap();
    assert!(
        response.get("errors").is_none(),
        "Native GraphQL failed: {response}"
    );
    response["data"].clone()
}
