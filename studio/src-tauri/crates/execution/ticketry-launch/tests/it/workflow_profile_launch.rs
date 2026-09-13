//! A workflow profile owns the Codex model and reasoning for the launch it
//! configures. A model-based global default must not leak into it: automated
//! delivery hands the resolved selection straight to the shared planner, which
//! refuses a profile combined with a model or a reasoning level.

use sea_orm::ConnectionTrait;
use std::collections::BTreeSet;
use std::path::PathBuf;
use ticketry_launch::{
    materialize, DurableLaunchMaterial, ExecutionAuthority, InteractiveLaunchAuthority, LaunchKind,
    Provider, ProviderOptions, TerminalLaunchKind, WorkspaceIdentity,
};
use ticketry_work_management::launch_policy::{
    CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};

use crate::launch_fixture::{caller_request, fixture, MODULE, PROJECT, TASK};

fn execution_authority() -> ExecutionAuthority {
    ExecutionAuthority::new(
        PathBuf::from("/approved/codex"),
        PathBuf::from("/authorized/workspace"),
        PathBuf::from("/Applications/Ticketry/ticketry-hook"),
        PathBuf::from("/private/spool"),
        "/private/Ticketry Data".into(),
        "Bearer secret-mcp".into(),
        BTreeSet::from(["tdd".into()]),
    )
}

/// The fixture's global default is a Codex model plus reasoning. A binding
/// that names a profile keeps both empty, all the way into an argv the planner
/// accepts.
#[tokio::test]
async fn a_stored_workflow_profile_refuses_the_global_model_default_through_planning() {
    let fixture = fixture().await;
    fixture
        .database
        .execute_unprepared("UPDATE worktracker_launchbinding SET profile = 'worker'")
        .await
        .unwrap();

    let decision = LaunchPolicyResolver::new(fixture.database.clone())
        .resolve(LaunchPolicyRequest {
            task_id: TASK.to_owned(),
            destination_state_id: None,
            provider_override: None,
            caller_scope: CallerScope::AutoStart,
            idempotency_key: "profile-launch".to_owned(),
            handoff: false,
        })
        .await
        .expect("resolve an automated launch against a profile binding");

    assert_eq!(decision.provider, "codex");
    assert_eq!(decision.profile.as_deref(), Some("worker"));
    assert_eq!(decision.model, None);
    assert_eq!(decision.reasoning, None);

    let durable = DurableLaunchMaterial::new(
        "run-1",
        LaunchKind::Automation,
        Provider::Codex,
        ProviderOptions {
            profile: decision.profile.clone(),
            model: decision.model.clone(),
            reasoning: decision.reasoning.clone(),
        },
        Some(decision.prompt.clone()),
        decision.required_skills.clone(),
        WorkspaceIdentity::Task {
            project_id: PROJECT.to_owned(),
            module_id: MODULE.to_owned(),
            task_id: TASK.to_owned(),
        },
        None,
    );
    let plan = materialize(&durable, &execution_authority())
        .expect("the planner accepts a profile-only launch");

    assert!(plan
        .argv
        .windows(2)
        .any(|pair| pair == ["--profile", "worker"]));
    assert!(!plan.argv.iter().any(|argument| argument == "--model"));
    assert!(!plan
        .argv
        .iter()
        .any(|argument| argument.contains("model_reasoning_effort")));
}

/// The same binding through the interactive authority: one resolution, one
/// answer, whichever door the launch came through.
#[tokio::test]
async fn the_interactive_authority_agrees_with_the_resolved_profile() {
    let fixture = fixture().await;
    fixture
        .database
        .execute_unprepared("UPDATE worktracker_launchbinding SET profile = 'worker'")
        .await
        .unwrap();

    let resolved = fixture
        .authority
        .resolve(&caller_request(TerminalLaunchKind::Automation))
        .await
        .expect("resolve an automation launch against a profile binding");

    assert_eq!(resolved.profile.as_deref(), Some("worker"));
    assert_eq!(resolved.model, None);
    assert_eq!(resolved.reasoning, None);
}

/// An explicit workflow model outranks a profiled global default: the
/// binding's resolved selection survives the interactive authority and an
/// end-to-end manual launch, rather than being cleared in favor of the
/// default's profile.
#[tokio::test]
async fn an_explicit_workflow_model_survives_a_profiled_global_default() {
    let fixture = fixture().await;
    fixture
        .database
        .execute_unprepared(
            "UPDATE worktracker_launchbinding SET model_id = '80000000000000000000000000000000',
             reasoning_id = '90000000000000000000000000000000';
             UPDATE app_settings SET value = '{\"global_default\":{\"provider\":\"codex\",\"profile\":\"worker\"}}'
             WHERE scope = 'host' AND \"key\" = 'provider_catalog'",
        )
        .await
        .unwrap();

    let decision = LaunchPolicyResolver::new(fixture.database.clone())
        .resolve(LaunchPolicyRequest {
            task_id: TASK.to_owned(),
            destination_state_id: None,
            provider_override: None,
            caller_scope: CallerScope::Interactive,
            idempotency_key: "explicit-model".to_owned(),
            handoff: false,
        })
        .await
        .expect("resolve a manual launch against an explicit model binding");
    assert_eq!(decision.profile, None);
    assert_eq!(decision.model.as_deref(), Some("gpt-5.6"));
    assert_eq!(decision.reasoning.as_deref(), Some("high"));

    let resolved = fixture
        .authority
        .resolve(&caller_request(TerminalLaunchKind::Task))
        .await
        .expect("resolve an interactive launch against an explicit model binding");
    assert_eq!(resolved.profile, None);
    assert_eq!(resolved.model.as_deref(), Some("gpt-5.6"));
    assert_eq!(resolved.reasoning.as_deref(), Some("high"));

    let durable = DurableLaunchMaterial::new(
        "run-2",
        LaunchKind::Task,
        Provider::Codex,
        ProviderOptions {
            profile: resolved.profile.clone(),
            model: resolved.model.clone(),
            reasoning: resolved.reasoning.clone(),
        },
        resolved.prompt.clone(),
        resolved.required_skills.clone(),
        WorkspaceIdentity::Task {
            project_id: PROJECT.to_owned(),
            module_id: MODULE.to_owned(),
            task_id: TASK.to_owned(),
        },
        None,
    );
    let plan = materialize(&durable, &execution_authority())
        .expect("the planner accepts the explicit model launch");
    assert!(plan
        .argv
        .windows(2)
        .any(|pair| pair == ["--model", "gpt-5.6"]));
    assert!(!plan.argv.iter().any(|argument| argument == "--profile"));
}

/// A per-launch provider override to another agent drops the Codex profile
/// rather than refusing the launch: the profile is a Codex-only option, and
/// the override already clears every other incompatible one.
#[tokio::test]
async fn a_provider_override_drops_the_stored_codex_profile() {
    let fixture = fixture().await;
    fixture
        .database
        .execute_unprepared("UPDATE worktracker_launchbinding SET profile = 'worker'")
        .await
        .unwrap();

    let decision = LaunchPolicyResolver::new(fixture.database.clone())
        .resolve(LaunchPolicyRequest {
            task_id: TASK.to_owned(),
            destination_state_id: None,
            provider_override: Some("claude".to_owned()),
            caller_scope: CallerScope::Interactive,
            idempotency_key: "profile-override".to_owned(),
            handoff: false,
        })
        .await
        .expect("a provider override drops the profile instead of being refused");

    assert_eq!(decision.provider, "claude");
    assert_eq!(decision.profile, None);
    assert_eq!(decision.model, None);
    assert_eq!(decision.reasoning, None);
}
