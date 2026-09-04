#[test]
fn generated_contract_keeps_runs_fields_and_custom_payloads() {
    let sdl = include_str!("../../../../../../src/graphql-foundation/generated/schema.graphql");
    assert!(sdl.contains(
        "automation_attempts(project_id: String!, task_id: String): [AutomationAttemptProjection!]!"
    ));
    assert!(
        sdl.contains("retry_automation_attempt(attempt_id: String!): AutomationAttemptProjection!")
    );
    assert!(sdl
        .contains("dismiss_automation_attempt(attempt_id: String!): AutomationAttemptProjection!"));
    assert!(sdl
        .contains("agent_run_holdings(project_id: String!, task_id: String): [AgentRunHolding!]!"));
    assert!(sdl.contains("ingest_agent_lifecycle(agent_run_id: String!, kind: String!, occurred_at: String!, provider_session_id: String): LifecycleAccepted!"));
    assert!(sdl.contains("type LifecycleAccepted {"));
    assert!(sdl.contains("type AutomationAttemptProjection {"));
}
