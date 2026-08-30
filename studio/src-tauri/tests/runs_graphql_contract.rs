#[tokio::test]
async fn nested_runs_views_keep_the_published_graphql_contract() {
    let sdl = muxed_studio_lib::graphql_foundation::generated_schema_sdl()
        .await
        .expect("build the GraphQL schema");

    for field in [
        "automation_attempts(project_id: String!, task_id: String): [AutomationAttemptProjection!]!",
        "retry_automation_attempt(attempt_id: String!): AutomationAttemptProjection!",
        "dismiss_automation_attempt(attempt_id: String!): AutomationAttemptProjection!",
        "agent_run_holdings(project_id: String!, task_id: String): [AgentRunHolding!]!",
        "ingest_agent_lifecycle(agent_run_id: String!, kind: String!, occurred_at: String!, provider_session_id: String): LifecycleAccepted!",
    ] {
        assert!(sdl.contains(field), "missing Runs field: {field}");
    }

    let attempt = output_type(&sdl, "AutomationAttemptProjection");
    for field in [
        "attempt_id: String!",
        "root_attempt_id: String!",
        "retry_of_attempt_id: String",
        "work_item_id: String!",
        "status: String!",
        "error: String",
        "failure: Json",
        "retryable: Boolean!",
        "agent_run_id: String",
        "updated_at: String!",
    ] {
        assert!(
            attempt.contains(field),
            "missing attempt payload field: {field}"
        );
    }

    let lifecycle = output_type(&sdl, "LifecycleAccepted");
    for field in [
        "accepted: Boolean!",
        "known_run: Boolean!",
        "applied: Boolean!",
        "state: String",
        "occurred_at: String!",
        "event_cursor: Int",
    ] {
        assert!(
            lifecycle.contains(field),
            "missing lifecycle payload field: {field}"
        );
    }
}

fn output_type<'a>(sdl: &'a str, name: &str) -> &'a str {
    sdl.split(&format!("type {name} {{"))
        .nth(1)
        .unwrap_or_else(|| panic!("missing output type: {name}"))
        .split("}\n")
        .next()
        .expect("output type body")
}
