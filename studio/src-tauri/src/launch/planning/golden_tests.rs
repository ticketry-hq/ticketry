use super::*;
use serde_json::json;
use std::collections::BTreeSet;
use std::path::PathBuf;

fn authority(provider: Provider) -> ExecutionAuthority {
    ExecutionAuthority::new(
        PathBuf::from(format!("/approved/{}", provider_contract(provider).slug)),
        PathBuf::from("/authorized/workspace"),
        PathBuf::from("/Applications/Ticketry/ticketry-hook"),
        PathBuf::from("/private/spool"),
        "http://127.0.0.1:8123/mcp".into(),
        "Bearer secret-mcp".into(),
        BTreeSet::from(["tdd".into()]),
    )
}

fn durable(provider: Provider, kind: LaunchKind) -> DurableLaunchMaterial {
    DurableLaunchMaterial::new(
        "run-1",
        kind,
        provider,
        ProviderOptions::default(),
        Some("hello".into()),
        vec!["tdd".into()],
        WorkspaceIdentity::Scratch {
            project_id: "project".into(),
            module_id: "module".into(),
            agent_run_id: "run-1".into(),
        },
        None,
    )
}

#[test]
fn provider_contracts_keep_flags_hooks_mcp_and_timeout_units() {
    let cases = [
        (
            Provider::Claude,
            "--permission-mode",
            TimeoutUnit::Seconds,
            8,
        ),
        (
            Provider::Codex,
            "--dangerously-bypass-hook-trust",
            TimeoutUnit::Seconds,
            6,
        ),
        (
            Provider::Gemini,
            "--approval-mode",
            TimeoutUnit::Milliseconds,
            7,
        ),
        (
            Provider::Agy,
            "--dangerously-skip-permissions",
            TimeoutUnit::Milliseconds,
            6,
        ),
    ];
    for (provider, flag, unit, events) in cases {
        let plan = materialize(&durable(provider, LaunchKind::Task), &authority(provider)).unwrap();
        assert!(plan.argv.iter().any(|argument| argument == flag));
        let contract = provider_contract(provider);
        assert!(contract.supports_worktracker_mcp);
        assert_eq!(contract.hook_timeout_unit, unit);
        assert_eq!(contract.hook_events.len(), events);
        if matches!(provider, Provider::Gemini | Provider::Agy) {
            assert_eq!(
                plan.settings.unwrap().environment_name,
                "GEMINI_CLI_SYSTEM_SETTINGS_PATH"
            );
        }
    }
}

#[test]
fn provider_model_and_reasoning_options_keep_the_established_cli_shapes() {
    let cases = [
        (
            Provider::Claude,
            Some("sonnet"),
            Some("high"),
            vec!["--model", "sonnet", "--effort", "high"],
        ),
        (
            Provider::Codex,
            Some("gpt-5.4"),
            Some("xhigh"),
            vec![
                "--model",
                "gpt-5.4",
                "-c",
                "model_reasoning_effort=\"xhigh\"",
            ],
        ),
        (Provider::Gemini, Some("pro"), None, vec!["--model", "pro"]),
        (Provider::Agy, Some("flash"), None, vec!["--model", "flash"]),
    ];
    for (provider, model, reasoning, expected) in cases {
        let mut input = durable(provider, LaunchKind::Task);
        input.options = ProviderOptions {
            model: model.map(str::to_owned),
            reasoning: reasoning.map(str::to_owned),
        };
        let plan = materialize(&input, &authority(provider)).unwrap();
        assert!(
            contains_sequence(&plan.argv, &expected),
            "argv: {:?}",
            plan.argv
        );
    }
}

#[test]
fn every_provider_builds_native_resume_argv() {
    for provider in [
        Provider::Claude,
        Provider::Codex,
        Provider::Gemini,
        Provider::Agy,
    ] {
        let plan = materialize(
            &durable(
                provider,
                LaunchKind::Resume {
                    provider_session_id: "session-α".into(),
                },
            ),
            &authority(provider),
        )
        .unwrap();
        assert_eq!(
            plan.argv[0],
            format!("/approved/{}", provider_contract(provider).slug)
        );
        assert!(plan.argv.iter().any(|argument| argument == "session-α"));
        assert!(!plan.argv.iter().any(|argument| argument == "hello"));
    }
}

#[test]
fn prompt_is_one_argv_value_even_when_large_quote_heavy_and_unicode() {
    let prompt = format!("say 'hello' \"world\" 東京 🦀\n{}", "x".repeat(128_000));
    for provider in [
        Provider::Claude,
        Provider::Codex,
        Provider::Gemini,
        Provider::Agy,
    ] {
        let mut input = durable(provider, LaunchKind::Task);
        input.prompt = Some(prompt.clone());
        let plan = materialize(&input, &authority(provider)).unwrap();
        assert_eq!(
            plan.argv
                .iter()
                .filter(|argument| *argument == &prompt)
                .count(),
            1
        );
    }
}

#[test]
fn executable_is_replaced_and_bad_identity_is_rejected() {
    let input = durable(Provider::Codex, LaunchKind::Task);
    let plan = materialize(&input, &authority(Provider::Codex)).unwrap();
    assert_eq!(plan.argv[0], "/approved/codex");
    assert_eq!(
        materialize(&input, &authority(Provider::Claude))
            .unwrap_err()
            .code,
        LaunchPlanningErrorCode::ExecutableUnavailable,
    );
}

#[test]
fn unavailable_skills_and_unsupported_options_fail_before_execution() {
    let mut input = durable(Provider::Gemini, LaunchKind::Task);
    input.required_skills = vec!["missing".into()];
    assert_eq!(
        materialize(&input, &authority(Provider::Gemini))
            .unwrap_err()
            .code,
        LaunchPlanningErrorCode::RequiredSkillUnavailable,
    );
    input.required_skills.clear();
    input.options.reasoning = Some("high".into());
    assert_eq!(
        materialize(&input, &authority(Provider::Gemini))
            .unwrap_err()
            .code,
        LaunchPlanningErrorCode::UnsupportedReasoning,
    );
    input.options = ProviderOptions {
        model: Some("model\"; shell".into()),
        reasoning: None,
    };
    assert_eq!(
        materialize(&input, &authority(Provider::Gemini))
            .unwrap_err()
            .code,
        LaunchPlanningErrorCode::UnsupportedModel,
    );
    assert_eq!(
        Provider::try_from("other").unwrap_err().code,
        LaunchPlanningErrorCode::UnknownProvider,
    );
    input.options = ProviderOptions::default();
    input.version = 99;
    assert_eq!(
        materialize(&input, &authority(Provider::Gemini))
            .unwrap_err()
            .code,
        LaunchPlanningErrorCode::UnsupportedVersion,
    );
}

#[test]
fn durable_json_cannot_hold_execution_only_material() {
    let value = serde_json::to_value(durable(Provider::Claude, LaunchKind::Task)).unwrap();
    let text = value.to_string();
    for forbidden in [
        "secret",
        "approved",
        "ticketry-hook",
        "spool",
        "command",
        "environment",
        "settings_path",
        "tmux",
    ] {
        assert!(
            !text.contains(forbidden),
            "durable material leaked {forbidden}"
        );
    }
    for forbidden in [
        "shell_command",
        "executable",
        "tmux_session_name",
        "tmux_socket",
        "hook_path",
        "environment",
        "working_directory",
        "settings_path",
    ] {
        let mut injected = value.clone();
        injected[forbidden] = json!("/tmp/evil; run anything");
        assert!(
            serde_json::from_value::<DurableLaunchMaterial>(injected).is_err(),
            "durable boundary accepted {forbidden}",
        );
    }
}

#[test]
fn automation_reuses_task_prompt_and_document_identity_stays_durable() {
    let task_prompt = "selected workflow\n\nwork item facts".to_owned();
    let mut automation = durable(Provider::Codex, LaunchKind::Automation);
    automation.prompt = Some(task_prompt.clone());
    let plan = materialize(&automation, &authority(Provider::Codex)).unwrap();
    assert!(plan.argv.iter().any(|argument| argument == &task_prompt));

    let document = DurableLaunchMaterial::new(
        "run-doc",
        LaunchKind::DocumentChat,
        Provider::Claude,
        ProviderOptions::default(),
        Some("edit HLD.html".into()),
        Vec::new(),
        WorkspaceIdentity::Document {
            project_id: "project".into(),
            module_id: "module".into(),
            document_id: "document-1".into(),
        },
        Some("document-1".into()),
    );
    let encoded = serde_json::to_value(document).unwrap();
    assert_eq!(encoded["document_id"], "document-1");
    assert_eq!(encoded["workspace"]["document_id"], "document-1");
}

fn contains_sequence(argv: &[String], expected: &[&str]) -> bool {
    argv.windows(expected.len()).any(|window| {
        window
            .iter()
            .map(String::as_str)
            .eq(expected.iter().copied())
    })
}
