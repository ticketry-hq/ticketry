use chrono::NaiveDateTime;

use super::{payload::GraphRunMutationPayload, support::graphql_error};
use crate::{
    entities::execution::graph_run,
    graph_run_service::{
        GraphRunResult, GraphRunServiceError, GraphRunServiceErrorCode, LaunchedChild,
    },
};

fn model() -> graph_run::Model {
    graph_run::Model {
        root_id: "40000000000000000000000000000001".into(),
        agent: Some("codex".into()),
        created_at: NaiveDateTime::default(),
        updated_at: NaiveDateTime::default(),
        module_id: Some("20000000000000000000000000000001".into()),
        project_id: "10000000000000000000000000000001".into(),
        execution_mode: "parallel".into(),
        launch_configuration: Some("secret prompt and required skills".into()),
    }
}

#[test]
fn result_keeps_only_authoritative_model_and_prepared_child_identities() {
    let payload = GraphRunMutationPayload::from(GraphRunResult {
        graph_run: model(),
        launched: vec![LaunchedChild {
            task_id: "50000000000000000000000000000001".into(),
            agent_run_id: "private-agent-run".into(),
            provider: "private-provider-material".into(),
        }],
    });
    assert_eq!(
        payload.prepared_child_ids.0,
        ["50000000-0000-0000-0000-000000000001"]
    );
}

#[test]
fn public_errors_discard_private_service_details() {
    let error = GraphRunServiceError::new(
        GraphRunServiceErrorCode::Storage,
        "graph_run_storage_failure",
        "secret prompt /Users/private command tmux-session raw-provider-output",
    );
    let public = graphql_error(error);
    assert_eq!(
        public.message,
        "The Graph Run operation could not be completed."
    );
    assert!(!format!("{public:?}").contains("/Users/private"));
    assert!(!format!("{public:?}").contains("tmux-session"));
}

#[test]
fn generated_contract_pins_the_restricted_mutation_bundle() {
    let sdl = include_str!("../../../../../src/graphql-foundation/generated/schema.graphql");
    let graph_run = sdl
        .split("type GraphRuns {")
        .nth(1)
        .unwrap()
        .split("}\n")
        .next()
        .unwrap();
    assert!(graph_run.contains("rootId: String!"));
    assert!(graph_run.contains("root: WorktrackerIssue"));
    assert!(graph_run.contains("project: WorktrackerProject"));
    for protected in [
        "launchConfiguration",
        "launchClaims",
        "agentRunId",
        "launchEffectId",
        "prompt",
        "path",
        "command",
        "tmux",
        "runtime",
    ] {
        assert!(!graph_run.contains(protected), "leaked {protected}");
    }
    assert!(sdl.contains("graph_run_create(root_id: String!, execution_mode: String)"));
    assert!(sdl.contains("graph_run_update(root_id: String!, execution_mode: String)"));
    assert!(sdl.contains("graph_run_delete(root_id: String!)"));
    assert!(!sdl.contains("graphRunsCreateOne"));
    assert!(!sdl.contains("graphRunsCreateBatch"));
    assert!(!sdl.contains("graphRunsUpdate"));
    assert!(!sdl.contains("graphRunsDelete"));
    assert!(!sdl.contains("type LaunchedTasks"));
}
