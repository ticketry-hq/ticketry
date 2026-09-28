//! Automatic Graph Run attempts follow the root's current status binding in
//! parallel campaigns, across provider, profile and skill edits, and after a
//! manual provider override on the kickoff.

mod common;

use common::graph_run_campaign_steps::*;
use common::graph_run_fixture::*;
use common::terminal_lifecycle_harness::{TerminalLifecycleHarness, TASK_ID};
use ticketry_agent_execution::graph::ExecutionMode;

const CLAUDE_PROVIDER: &str = "00000000000000000000000000008962";
const CLAUDE_MODEL: &str = "00000000000000000000000000008963";
const HIGH: &str =
    "(SELECT id FROM worktracker_reasoninglevel WHERE name='high' ORDER BY id LIMIT 1)";

#[tokio::test]
async fn parallel_advancement_launches_each_child_with_current_model_and_reasoning() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    let service = service(&database);
    arm_parallel_behind_external(&database, &service).await;

    run(&database, &format!(
        "{}; \
         INSERT OR IGNORE INTO worktracker_reasoninglevel(id,name) VALUES ('00000000000000000000000000008965','high'); \
         INSERT INTO worktracker_agentmodelreasoninglevel(agent_model_id,reasoning_level_id) VALUES ('{FRESH_MODEL}',{HIGH}); \
         UPDATE worktracker_launchbinding SET model_id='{FRESH_MODEL}', reasoning_id={HIGH}; \
         UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{EXTERNAL}'",
        codex_model(FRESH_MODEL, "fresh-model")
    ))
    .await;
    let advanced = service.advance(TASK_ID).await.unwrap();
    let mut launched = advanced
        .launched
        .iter()
        .map(|c| c.task_id.as_str())
        .collect::<Vec<_>>();
    launched.sort();
    assert_eq!(launched, [CHILD_A, CHILD_B]);

    let a = prepared_launch(&database, CHILD_A).await;
    let b = prepared_launch(&database, CHILD_B).await;
    for launch in [&a, &b] {
        assert_eq!(launch.model.as_deref(), Some("fresh-model"));
        assert_eq!(launch.reasoning.as_deref(), Some("high"));
        assert_eq!(launch.run_model.as_deref(), Some("fresh-model"));
        assert_eq!(launch.run_reasoning.as_deref(), Some("high"));
    }
    // Each child is its own attempt: its own Agent Run, request, effect and
    // claim generation. (Graph Run decisions are not persisted, so distinct
    // decision ids are not observable here.)
    assert_ne!(a.agent_run_id, b.agent_run_id);
    assert_ne!(a.request_id, b.request_id);
    assert_ne!(a.effect_id, b.effect_id);
    assert_claims_match_material(&database, &[CHILD_A, CHILD_B]).await;
    assert!(service.advance(TASK_ID).await.unwrap().launched.is_empty());
}

#[tokio::test]
async fn profile_skill_and_provider_edits_follow_the_binding_on_the_next_automatic_run() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    run(
        &database,
        &format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id='{BLOCKED}'; {}",
            claude_model()
        ),
    )
    .await;
    let service = service(&database);
    let first = service
        .create_or_press(request(ExecutionMode::Serial, None))
        .await
        .unwrap();
    assert_eq!(task_ids(&first), [CHILD_A]);
    let a = prepared_launch(&database, CHILD_A).await;

    run(&database, &format!(
        "UPDATE worktracker_launchbinding SET profile='fresh-profile', model_id=NULL, reasoning_id=NULL, \
            required_skills='[\"tdd\"]', stage_skills='[\"code-review\"]'; {}",
        finish(CHILD_A, &a.agent_run_id)
    ))
    .await;
    let second = service.advance(TASK_ID).await.unwrap();
    assert_eq!(
        second
            .launched
            .iter()
            .map(|c| c.task_id.as_str())
            .collect::<Vec<_>>(),
        [CHILD_B]
    );
    let b = prepared_launch(&database, CHILD_B).await;
    assert_eq!(b.provider.as_deref(), Some("codex"));
    assert_eq!(b.profile.as_deref(), Some("fresh-profile"));
    assert_eq!(b.model, None);
    assert_eq!(skills(&b.required_skills), ["tdd"]);
    assert!(b
        .prompt
        .contains("Use these skills for this stage: [\"code-review\"]"));

    run(
        &database,
        &format!(
            "UPDATE worktracker_launchbinding SET profile=NULL, model_id='{CLAUDE_MODEL}', \
            required_skills='[\"to-spec\"]', stage_skills='[]'; {}",
            finish(CHILD_B, &b.agent_run_id)
        ),
    )
    .await;
    let third = service.advance(TASK_ID).await.unwrap();
    assert_eq!(
        third
            .launched
            .iter()
            .map(|c| c.task_id.as_str())
            .collect::<Vec<_>>(),
        [READY]
    );
    let ready = prepared_launch(&database, READY).await;
    assert_eq!(ready.provider.as_deref(), Some("claude"));
    assert_eq!(ready.run_agent.as_deref(), Some("claude"));
    assert_eq!(ready.model.as_deref(), Some("claude-test-model"));
    assert_eq!(ready.profile, None);
    assert_eq!(skills(&ready.required_skills), ["to-spec"]);
    assert!(!ready.prompt.contains("Stage skills:"));

    // Earlier prepared attempts keep what they launched with.
    assert_eq!(prepared_launch(&database, CHILD_A).await, a);
    assert_eq!(skills(&a.required_skills), Vec::<String>::new());
    assert_eq!(a.model.as_deref(), Some("graph-run-test-model"));
    assert_eq!(
        prepared_launch(&database, CHILD_B).await.profile.as_deref(),
        Some("fresh-profile")
    );
    assert_claims_match_material(&database, &[CHILD_A, CHILD_B, READY]).await;
}

#[tokio::test]
async fn kickoff_provider_override_applies_to_the_manual_launch_only() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    run(
        &database,
        &format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{BLOCKED}','{READY}'); {}",
            claude_model()
        ),
    )
    .await;
    let service = service(&database);
    let first = service
        .create_or_press(request(ExecutionMode::Serial, Some("claude")))
        .await
        .unwrap();
    assert_eq!(task_ids(&first), [CHILD_A]);
    assert_eq!(first.graph_run.agent.as_deref(), Some("claude"));
    let a = prepared_launch(&database, CHILD_A).await;
    assert_eq!(a.provider.as_deref(), Some("claude"));
    assert_eq!(a.run_agent.as_deref(), Some("claude"));
    assert_eq!(a.model, None);

    run(&database, &finish(CHILD_A, &a.agent_run_id)).await;
    let advanced = service.advance(TASK_ID).await.unwrap();
    assert_eq!(
        advanced
            .launched
            .iter()
            .map(|c| c.task_id.as_str())
            .collect::<Vec<_>>(),
        [CHILD_B]
    );
    assert_eq!(advanced.launched[0].provider, "codex");
    let b = prepared_launch(&database, CHILD_B).await;
    assert_eq!(b.provider.as_deref(), Some("codex"));
    assert_eq!(b.run_agent.as_deref(), Some("codex"));
    assert_eq!(b.model.as_deref(), Some("graph-run-test-model"));
    assert_eq!(prepared_launch(&database, CHILD_A).await, a);
    assert_claims_match_material(&database, &[CHILD_A, CHILD_B]).await;
}

fn claude_model() -> String {
    format!(
        "INSERT OR IGNORE INTO worktracker_provider(id,slug,activated,supports_unattended) VALUES ('{CLAUDE_PROVIDER}','claude',1,1); \
         UPDATE worktracker_provider SET activated=1 WHERE slug='claude'; \
         INSERT INTO worktracker_agentmodel(id,provider_id,name) \
         SELECT '{CLAUDE_MODEL}',id,'claude-test-model' FROM worktracker_provider WHERE slug='claude'"
    )
}

/// Satisfy a child and end its Run so serial advancement moves past it.
fn finish(child: &str, agent_run_id: &str) -> String {
    format!(
        "UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{child}'; \
         UPDATE agent_runs SET ended_at='ended' WHERE id='{agent_run_id}'; \
         UPDATE agent_terminal_sessions SET terminated_at='ended' WHERE agent_run_id='{agent_run_id}'"
    )
}

fn skills(encoded: &str) -> Vec<String> {
    serde_json::from_str(encoded).unwrap()
}
