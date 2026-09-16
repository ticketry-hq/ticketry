//! An interactive launch may name identities. It may not name its own launch
//! policy: the provider catalog, the launch binding, the document registry,
//! and the canonical prompt shapes decide what a run is allowed to start with.

use std::path::Path;
use std::process::Command;

use sea_orm::ConnectionTrait;
use ticketry_launch::{InteractiveLaunchAuthority, TerminalLaunchKind};
use ticketry_provider::{
    provider_contract, DirectoryTrustContext, DirectoryTrustInspection, DirectoryTrustPreparation,
    Provider,
};

use crate::launch_fixture::{
    caller_request, fixture, DOCUMENT, MODULE, PROJECT, STATE, TASK, TYPE,
};

#[test]
fn worktree_launch_trust_uses_disposable_provider_state() {
    let state = tempfile::tempdir().unwrap();
    let trust_file = state.path().join("gemini-trust.json");
    assert!(Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "interactive_launch_authority::worktree_launch_trust_child",
            "--ignored",
            "--nocapture",
        ])
        .env("TICKETRY_WORKTREE_TRUST_TEST_FILE", &trust_file)
        .env("GEMINI_CLI_TRUSTED_FOLDERS_PATH", trust_file)
        .status()
        .unwrap()
        .success());
}

#[tokio::test]
#[ignore]
async fn worktree_launch_trust_child() {
    let Some(trust_file) = std::env::var_os("TICKETRY_WORKTREE_TRUST_TEST_FILE") else {
        return;
    };
    assert_eq!(
        std::env::var_os("GEMINI_CLI_TRUSTED_FOLDERS_PATH").as_deref(),
        Some(trust_file.as_os_str()),
    );
    let fixture = fixture().await;
    let checkout = Path::new(&fixture.folder).join("external-worktree");
    std::fs::create_dir(&checkout).unwrap();
    fixture
        .database
        .execute_unprepared(&format!(
            r#"
        UPDATE worktracker_provider SET activated = 1 WHERE slug = 'gemini';
        INSERT INTO worktrees VALUES (
            '71000000000000000000000000000000', '{TASK}', 'meml', '{PROJECT}',
            '{MODULE}', 965, '{module}', '{checkout}', 'wt/CODIN-965-resolve-launch-policy',
            'main', 'base', 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
        );
    "#,
            module = fixture.folder,
            checkout = checkout.display()
        ))
        .await
        .unwrap();

    let mut unattended = caller_request(TerminalLaunchKind::Automation);
    unattended.provider = Some("gemini".to_owned());
    let refusal = fixture.authority.resolve(&unattended).await.unwrap_err();
    assert!(refusal
        .to_string()
        .contains("worktree_trust_approval_required"));
    assert!(refusal.to_string().contains(checkout.to_str().unwrap()));

    let provider = provider_contract(Provider::Gemini);
    let context = DirectoryTrustContext {
        directory: &checkout,
        trust_file: None,
    };
    let DirectoryTrustInspection::ApprovalRequired(approval) =
        provider.inspect_directory_trust(context)
    else {
        panic!("fresh external Worktree must require approval");
    };
    assert_eq!(
        provider.prepare_directory_trust(context, Some(&approval)),
        DirectoryTrustPreparation::Prepared,
    );
    fixture.authority.resolve(&unattended).await.unwrap();

    const CHILD: &str = "60000000000000000000000000000001";
    fixture
        .database
        .execute_unprepared(&format!(
            r#"
        INSERT INTO worktracker_issue VALUES
            ('{CHILD}', '{PROJECT}', 'task', '{TYPE}', '{TASK}', '{MODULE}', '{STATE}', 0,
             'Shared child', 966, 0, 'O', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    "#
        ))
        .await
        .unwrap();
    let mut shared = caller_request(TerminalLaunchKind::Task);
    shared.issue_id = CHILD.to_owned();
    shared.target_id = CHILD.to_owned();
    shared.working_directory_identity = format!("task:{CHILD}");
    shared.provider = Some("gemini".to_owned());
    fixture.authority.resolve(&shared).await.unwrap();
}

#[tokio::test]
async fn agy_worktree_launch_does_not_require_directory_trust() {
    let fixture = fixture().await;
    let checkout = Path::new(&fixture.folder).join("agy-worktree");
    std::fs::create_dir(&checkout).unwrap();
    fixture
        .database
        .execute_unprepared(&format!(
            r#"
        INSERT INTO worktracker_provider VALUES
            ('70000000000000000000000000000003', 'agy', 1, 1);
        INSERT INTO worktrees VALUES (
            '71000000000000000000000000000001', '{TASK}', 'meml', '{PROJECT}',
            '{MODULE}', 965, '{module}', '{checkout}', 'wt/CODIN-965-agy-launch',
            'main', 'base', 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
        );
    "#,
            module = fixture.folder,
            checkout = checkout.display()
        ))
        .await
        .unwrap();

    let mut request = caller_request(TerminalLaunchKind::Task);
    request.provider = Some("agy".to_owned());

    let resolved = fixture.authority.resolve(&request).await.unwrap();
    assert_eq!(resolved.provider.as_deref(), Some("agy"));
}

#[tokio::test]
async fn a_manual_task_launch_keeps_ticket_context_without_the_workflow_prompt() {
    let fixture = fixture().await;

    let resolved = fixture
        .authority
        .resolve(&caller_request(TerminalLaunchKind::Task))
        .await
        .expect("resolve an interactive task launch");

    assert_eq!(resolved.provider.as_deref(), Some("codex"));
    assert_eq!(resolved.model.as_deref(), Some("gpt-5.6"));
    assert_eq!(resolved.reasoning.as_deref(), Some("high"));
    assert_eq!(resolved.required_skills, ["tdd"]);
    assert_eq!(
        resolved.policy_reference.as_deref(),
        Some("launch-binding:1")
    );
    assert_eq!(resolved.design_directory_identity, None);
    assert_eq!(resolved.document_relative_path, None);
    let prompt = resolved.prompt.expect("a task launch carries a prompt");
    assert!(prompt.starts_with("Work item context (factual):"));
    for expected in [
        "Source: WorkTracker (ticket #965)",
        "Task: Resolve launch policy",
        "State: Implement",
        "Type: Implementation",
        "Description:\nFirst\n\nSecond",
        // The caller's free text stays user input, never authority.
        "Additional user instructions:\ncaller text",
        "Design directory: spec/terminal--50000000/T965--resolve-launch-policy",
    ] {
        assert!(prompt.contains(expected), "prompt is missing {expected:?}");
    }
    assert!(!prompt.contains("Selected workflow prompt:"));
    assert!(!prompt.contains("Only this child's agreed slice."));
    assert!(!prompt.contains("caller-chosen"));
}

#[tokio::test]
async fn an_automation_launch_keeps_the_workflow_prompt_and_ticket_description() {
    let fixture = fixture().await;

    let resolved = fixture
        .authority
        .resolve(&caller_request(TerminalLaunchKind::Automation))
        .await
        .expect("resolve an automation launch");

    let prompt = resolved
        .prompt
        .expect("an automation launch carries a prompt");
    assert!(prompt.starts_with(
        "Selected workflow prompt:\nOnly this child's agreed slice.\n\nWork item context (factual):"
    ));
    assert!(prompt.contains("Description:\nFirst\n\nSecond"));
}

#[tokio::test]
async fn the_picker_still_chooses_the_agent_and_the_catalog_still_governs_it() {
    let fixture = fixture().await;
    let mut picked = caller_request(TerminalLaunchKind::Task);
    picked.provider = Some("claude".to_owned());

    let resolved = fixture.authority.resolve(&picked).await.unwrap();
    assert_eq!(resolved.provider.as_deref(), Some("claude"));
    // A picked agent selects the provider; it never smuggles in a model.
    assert_eq!(resolved.model, None);
    assert_eq!(resolved.required_skills, ["tdd"]);

    let mut dormant = caller_request(TerminalLaunchKind::Task);
    dormant.provider = Some("gemini".to_owned());
    assert!(fixture.authority.resolve(&dormant).await.is_err());
}

#[tokio::test]
async fn a_planning_launch_builds_the_module_planning_prompt() {
    let fixture = fixture().await;

    let resolved = fixture
        .authority
        .resolve(&caller_request(TerminalLaunchKind::Planning))
        .await
        .expect("resolve an interactive planning launch");

    assert_eq!(resolved.provider.as_deref(), Some("codex"));
    assert_eq!(resolved.model, None);
    assert_eq!(resolved.reasoning, None);
    assert_eq!(resolved.policy_reference, None);
    assert!(resolved.required_skills.is_empty());
    let prompt = resolved.prompt.expect("a planning launch carries a prompt");
    assert!(prompt.starts_with(
        "You are a planning assistant helping design new features for the 'Terminal' module."
    ));
    for expected in [
        "Project: MAIN",
        &format!("Local Codebase: {}", fixture.folder),
        "  - #965 Resolve launch policy [Implement]",
        "Design directory: spec/terminal--50000000/planning/",
        "Do not start implementing. This is a planning session only.",
    ] {
        assert!(prompt.contains(expected), "prompt is missing {expected:?}");
    }
    assert!(!prompt.contains("caller text"));
}

#[tokio::test]
async fn an_instant_launch_wraps_a_submitted_request_or_waits_for_terminal_input() {
    let fixture = fixture().await;

    let resolved = fixture
        .authority
        .resolve(&caller_request(TerminalLaunchKind::Instant))
        .await
        .expect("resolve an interactive instant launch");

    let prompt = resolved.prompt.expect("an instant launch carries a prompt");
    assert!(prompt.starts_with("Context:\n  Module: Terminal\n"));
    for hidden in [
        "small, instant change",
        "Your job:",
        "Do not refactor",
        "Plan Feature",
        "Do not create or update WorkTracker",
        "Do not update any WorkTracker",
    ] {
        assert!(
            !prompt.contains(hidden),
            "unexpected hidden instruction: {hidden}"
        );
    }
    assert!(prompt.contains("User's request:\n  caller text"));
    assert!(prompt.contains("terminate_current_run"));

    let mut silent = caller_request(TerminalLaunchKind::Instant);
    silent.prompt = None;
    let prompt = fixture
        .authority
        .resolve(&silent)
        .await
        .expect("start an Instant conversation without a submitted request")
        .prompt
        .expect("launch authority supplies the conversation instructions");
    assert!(prompt.contains("Wait for the user to type their first request in this terminal."));
    assert!(!prompt.contains("User's request:"));
    assert!(!prompt.contains("small, instant change"));
    assert!(!prompt.contains("Plan Feature"));
}

#[tokio::test]
async fn an_unprompted_instant_launch_uses_the_global_default_model() {
    let fixture = fixture().await;
    let mut request = caller_request(TerminalLaunchKind::Instant);
    request.provider = None;
    request.prompt = None;

    let resolved = fixture
        .authority
        .resolve(&request)
        .await
        .expect("resolve Instant from the global default");

    assert_eq!(resolved.provider.as_deref(), Some("codex"));
    assert_eq!(resolved.model.as_deref(), Some("gpt-5.6"));
    assert_eq!(resolved.reasoning.as_deref(), Some("high"));
    assert!(!resolved.prompt.unwrap().contains("caller-chosen"));
}

#[tokio::test]
async fn instant_settings_add_standing_instructions_and_auto_close_authority() {
    let fixture = fixture().await;
    fixture
        .database
        .execute_unprepared(
            r#"INSERT INTO app_settings VALUES (
                'host', 'instant_launch',
                '{"initial_prompt":"Never edit generated files directly.","auto_close":true}',
                CURRENT_TIMESTAMP
            )"#,
        )
        .await
        .unwrap();

    let resolved = fixture
        .authority
        .resolve(&caller_request(TerminalLaunchKind::Instant))
        .await
        .unwrap();
    let prompt = resolved.prompt.unwrap();

    assert!(
        prompt.contains("Configured Instant instructions:\nNever edit generated files directly.")
    );
    assert!(!prompt.contains("May I terminate this run"));
    assert!(prompt.contains("then invoke terminate_current_run"));
}

#[tokio::test]
async fn a_doc_chat_launch_names_the_registered_document_not_the_submitted_path() {
    let fixture = fixture().await;
    let mut request = caller_request(TerminalLaunchKind::DocumentChat);
    request.issue_id = DOCUMENT.to_owned();
    request.target_id = DOCUMENT.to_owned();

    let resolved = fixture
        .authority
        .resolve(&request)
        .await
        .expect("resolve an interactive doc-chat launch");

    assert_eq!(
        resolved.document_relative_path.as_deref(),
        Some("T965--launch/HLD.html")
    );
    assert_eq!(
        resolved.design_directory_identity.as_deref(),
        Some(DOCUMENT)
    );
    let prompt = resolved.prompt.expect("a doc-chat launch carries a prompt");
    assert!(prompt.contains("Target document (in your working directory): T965--launch/HLD.html"));
    assert!(prompt.contains(&format!("Local Module Folder: {}", fixture.folder)));
    assert!(prompt.contains("The user's requested change:\ncaller text"));
    assert!(!prompt.contains("caller-chosen.html"));
}

#[tokio::test]
async fn a_shell_launch_has_no_agent_material_to_resolve() {
    let fixture = fixture().await;
    let mut shell = caller_request(TerminalLaunchKind::Shell);
    shell.issue_id = MODULE.to_owned();

    assert!(fixture.authority.resolve(&shell).await.is_err());
}

/// A stored workflow profile has to reach the durable launch material a manual
/// launch persists, and it outranks the global default on the way there.
#[tokio::test]
async fn a_workflow_profile_reaches_the_durable_material_ahead_of_the_global_default() {
    let fixture = fixture().await;
    fixture
        .database
        .execute_unprepared(
            r#"UPDATE app_settings SET value =
                '{"global_default":{"provider":"codex","profile":"global"}}'
               WHERE "key" = 'provider_catalog';
               UPDATE worktracker_launchbinding SET profile = 'workflow';"#,
        )
        .await
        .unwrap();

    let mut request = caller_request(TerminalLaunchKind::Task);
    let resolved = fixture
        .authority
        .resolve(&request)
        .await
        .expect("resolve a manual task launch against a profile binding");

    assert_eq!(resolved.profile.as_deref(), Some("workflow"));
    // Codex takes a profile or a model, never both.
    assert_eq!(resolved.model, None);
    assert_eq!(resolved.reasoning, None);
    resolved.apply(&mut request);
    assert_eq!(request.profile.as_deref(), Some("workflow"));
}

/// Without a workflow profile the global default still supplies one, so no
/// launch path silently drops `--profile`.
#[tokio::test]
async fn the_global_profile_fills_a_binding_that_names_none() {
    let fixture = fixture().await;
    fixture
        .database
        .execute_unprepared(
            r#"UPDATE app_settings SET value =
                '{"global_default":{"provider":"codex","profile":"global"}}'
               WHERE "key" = 'provider_catalog'"#,
        )
        .await
        .unwrap();

    let mut request = caller_request(TerminalLaunchKind::Task);
    let resolved = fixture.authority.resolve(&request).await.unwrap();

    assert_eq!(resolved.profile.as_deref(), Some("global"));
    resolved.apply(&mut request);
    assert_eq!(request.profile.as_deref(), Some("global"));
}
