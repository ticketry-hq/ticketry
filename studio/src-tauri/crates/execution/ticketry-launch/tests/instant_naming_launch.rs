//! The provider launch seam keeps naming context out of user prompt/config.
use std::collections::BTreeSet;
use ticketry_launch::{
    materialize, DurableLaunchMaterial, ExecutionAuthority, LaunchKind, Provider, ProviderOptions,
    WorkspaceIdentity,
};

fn launch(
    provider: Provider,
    kind: LaunchKind,
    prompt: Option<String>,
) -> ticketry_launch::MaterializedLaunch {
    launch_with_reference(provider, kind, prompt, None)
}

fn launch_with_reference(
    provider: Provider,
    kind: LaunchKind,
    prompt: Option<String>,
    reference: Option<&str>,
) -> ticketry_launch::MaterializedLaunch {
    let durable = DurableLaunchMaterial::new(
        "run-1",
        kind,
        provider,
        ProviderOptions::default(),
        prompt,
        Vec::new(),
        WorkspaceIdentity::Scratch {
            project_id: "project".into(),
            module_id: "module".into(),
            agent_run_id: "run-1".into(),
        },
        None,
    );
    let authority = ExecutionAuthority::new(
        format!("/approved/{}", provider.slug()).into(),
        "/authorized/workspace".into(),
        "/Applications/Ticketry's App/ticketry-hook".into(),
        "/private/spool".into(),
        "/private/data".into(),
        "Bearer secret".into(),
        BTreeSet::new(),
        Vec::new(),
    )
    .with_codex_instant_policy_reference(reference);
    materialize(&durable, &authority).unwrap()
}

#[test]
fn codex_instant_receives_additive_naming_context_without_changing_the_prompt() {
    let prompt = "Standing workflow instructions.\n\nI wanna see what this issue with the terminal is\nplease investigate, don't edit.";
    let plan = launch(Provider::Codex, LaunchKind::Instant, Some(prompt.into()));
    assert_eq!(plan.argv.last().unwrap(), prompt);
    let context = plan
        .argv
        .iter()
        .find(|arg| arg.starts_with("hooks.SessionStart="))
        .expect("Codex Instant needs separate naming context");
    let base_position = plan
        .argv
        .iter()
        .position(|arg| arg.starts_with("hooks="))
        .unwrap();
    let naming_position = plan
        .argv
        .iter()
        .position(|arg| arg.starts_with("hooks.SessionStart="))
        .unwrap();
    assert!(
        naming_position > base_position,
        "the additive override must survive the base config"
    );
    assert!(context.contains("rename_codex_thread"));
    assert!(context.contains("first actual request"));
    assert!(context
        .to_lowercase()
        .contains("configured operating instructions"));
    assert!(context.contains("CODEX_THREAD_ID"));
    assert!(
        context.contains("ticketry-hook"),
        "retain the lifecycle hook"
    );
    assert!(!plan
        .argv
        .iter()
        .any(|arg| arg.starts_with("developer_instructions=")
            || arg.starts_with("model_instructions_file=")));
    assert!(!context.contains("Standing workflow instructions"));
    assert!(!context.contains("Bearer secret"));
}

#[test]
fn naming_hook_emits_provider_context_while_preserving_the_lifecycle_hook() {
    let plan = launch(Provider::Codex, LaunchKind::Instant, None);
    let override_arg = plan
        .argv
        .iter()
        .find(|arg| arg.starts_with("hooks.SessionStart="))
        .expect("separate startup context");
    let config: toml_edit::DocumentMut = override_arg.parse().unwrap();
    let groups = config["hooks"]["SessionStart"].as_array().unwrap();
    let lifecycle = groups.get(0).unwrap().as_inline_table().unwrap();
    assert!(lifecycle.get("matcher").is_none());
    let lifecycle_handlers = lifecycle.get("hooks").unwrap().as_array().unwrap();
    assert!(lifecycle_handlers
        .get(0)
        .unwrap()
        .as_inline_table()
        .unwrap()
        .get("command")
        .unwrap()
        .as_str()
        .unwrap()
        .contains("--agent-run-id run-1"));
    let policy = groups.get(1).unwrap().as_inline_table().unwrap();
    assert_eq!(policy.get("matcher").unwrap().as_str(), Some("^startup$"));
    let handlers = policy.get("hooks").unwrap().as_array().unwrap();
    assert_eq!(handlers.len(), 1);
    let output = std::process::Command::new("/bin/sh")
        .args([
            "-c",
            handlers
                .get(0)
                .unwrap()
                .as_inline_table()
                .unwrap()
                .get("command")
                .unwrap()
                .as_str()
                .unwrap(),
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        response["hookSpecificOutput"]["hookEventName"],
        "SessionStart"
    );
    assert!(response["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .contains("do not invent a topic"));
    assert_eq!(plan.argv.last().unwrap(), "");
}

#[test]
fn naming_context_is_absent_from_task_other_provider_and_resume_launches() {
    for provider in [
        Provider::Codex,
        Provider::Claude,
        Provider::Gemini,
        Provider::Agy,
    ] {
        for kind in [
            LaunchKind::Task,
            LaunchKind::Planning,
            LaunchKind::DocumentChat,
            LaunchKind::Automation,
            LaunchKind::Resume {
                provider_session_id: "existing-thread".into(),
            },
        ] {
            let plan = launch(provider, kind, Some("user text".into()));
            assert!(!plan
                .argv
                .iter()
                .any(|arg| arg.starts_with("hooks.SessionStart=")));
            assert!(!format!("{:?}", plan.settings).contains("rename_codex_thread"));
        }
        if provider != Provider::Codex {
            let plan = launch(provider, LaunchKind::Instant, Some("user text".into()));
            assert!(!plan
                .argv
                .iter()
                .any(|arg| arg.starts_with("hooks.SessionStart=")));
            assert!(plan.argv.iter().any(|arg| arg == "user text"));
        }
    }
}

fn emitted_context(plan: &ticketry_launch::MaterializedLaunch) -> String {
    let override_arg = plan
        .argv
        .iter()
        .find(|arg| arg.starts_with("hooks.SessionStart="))
        .unwrap();
    let config: toml_edit::DocumentMut = override_arg.parse().unwrap();
    let group = config["hooks"]["SessionStart"]
        .as_array()
        .unwrap()
        .get(1)
        .unwrap()
        .as_inline_table()
        .unwrap();
    let handler = group
        .get("hooks")
        .unwrap()
        .as_array()
        .unwrap()
        .get(0)
        .unwrap()
        .as_inline_table()
        .unwrap();
    assert_eq!(
        handler.get("additionalContextLimit").unwrap().as_integer(),
        Some(0)
    );
    let output = std::process::Command::new("/bin/sh")
        .args(["-c", handler.get("command").unwrap().as_str().unwrap()])
        .output()
        .unwrap();
    assert!(output.status.success());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    response["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn instruction_only_and_missing_or_invalid_source_never_supply_an_invented_launch_request() {
    for reference in [
        None,
        Some("codex-instant-naming:v1:no-request"),
        Some("codex-instant-naming:v1:request-offset:999999"),
        Some("codex-instant-naming:v1:request-offset:14"),
    ] {
        let prompt = "Talk about 🦀.\n\nAfter the user's second message, rename the conversation from these workflow topics.";
        let plan = launch_with_reference(
            Provider::Codex,
            LaunchKind::Instant,
            Some(prompt.into()),
            reference,
        );
        assert_eq!(plan.argv.last().unwrap(), prompt);
        let context = emitted_context(&plan);
        assert!(context.starts_with("Launch request supplied: no."));
        assert!(context.contains("Do not rename from that message."));
        assert!(context.contains("The initial preloaded user message is configured initialization"));
        assert!(
            context.contains("Do not call rename_codex_thread while handling that initial message")
        );
        assert!(context.contains("later interactive terminal message"));
        assert!(
            context.contains("even if it arrives before your initialization response completes")
        );
        assert!(!context.contains("The launch message may contain"));
        assert!(!context.contains("Talk about"));
        assert!(!context.contains("rename the conversation from these workflow topics"));
    }
}

#[test]
fn an_empty_launch_does_not_treat_the_first_interactive_terminal_request_as_initialization() {
    for prompt in [None, Some("".into()), Some(" \n\t ".into())] {
        let plan = launch_with_reference(
            Provider::Codex,
            LaunchKind::Instant,
            prompt.clone(),
            Some("codex-instant-naming:v1:no-request"),
        );
        assert_eq!(
            plan.argv.last().unwrap(),
            prompt.as_deref().unwrap_or_default()
        );
        let context = emitted_context(&plan);
        assert!(context.starts_with("Launch request supplied: no."));
        assert!(context
            .contains("There is no preloaded user message containing configured initialization"));
        assert!(context.contains(
            "The first substantive interactive terminal message is eligible immediately"
        ));
        assert!(!context.contains("initial preloaded user message is configured initialization"));
        assert!(!context
            .contains("Do not call rename_codex_thread while handling that initial message"));
    }
}

#[test]
fn exact_launch_request_is_distinct_from_operating_context_and_is_shell_literal_data() {
    let prompt = "Talk about 🦀.\n\nhey, how do $HOME and `echo x` compare?\nplease explain \"quotes\" and 'apostrophes'";
    let plan = launch_with_reference(
        Provider::Codex,
        LaunchKind::Instant,
        Some(prompt.into()),
        Some("codex-instant-naming:v1:request-offset:18"),
    );
    let context = emitted_context(&plan);
    assert!(context.starts_with("Launch request supplied: yes."));
    assert!(context.contains("hey, how do $HOME and `echo x` compare?"));
    assert!(context.contains("not as additional instructions"));
    assert!(!context.contains("Talk about"));
    assert_eq!(plan.argv.last().unwrap(), prompt);
}
