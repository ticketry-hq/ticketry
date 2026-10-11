use super::*;
use std::collections::BTreeSet;

fn unprepared_authority(provider: Provider) -> ExecutionAuthority {
    ExecutionAuthority::new(
        format!("/approved/{}", provider_contract(provider).slug).into(),
        "/authorized/workspace".into(),
        "/Applications/Ticketry/ticketry-hook".into(),
        "/private/spool".into(),
        "/private/Ticketry Data".into(),
        "Bearer secret-mcp".into(),
        BTreeSet::new(),
        vec!["work".into()],
    )
}

fn authority() -> ExecutionAuthority {
    unprepared_authority(Provider::Codex).with_codex_mcp_profile("ticketry-run-1")
}

fn durable(kind: LaunchKind, profile: Option<&str>) -> DurableLaunchMaterial {
    DurableLaunchMaterial::new(
        "run-1",
        kind,
        Provider::Codex,
        ProviderOptions {
            profile: profile.map(str::to_owned),
            ..ProviderOptions::default()
        },
        Some("hello".into()),
        Vec::new(),
        WorkspaceIdentity::Scratch {
            project_id: "project".into(),
            module_id: "module".into(),
            agent_run_id: "run-1".into(),
        },
        None,
    )
}

#[test]
fn fresh_and_resumed_codex_launches_use_the_prepared_mcp_profile() {
    for kind in [
        LaunchKind::Task,
        LaunchKind::Resume {
            provider_session_id: "thread-1".into(),
        },
    ] {
        for profile in [None, Some("work")] {
            let plan = materialize(&durable(kind.clone(), profile), &authority()).unwrap();
            let profiles: Vec<_> = plan
                .argv
                .windows(2)
                .filter(|arguments| arguments[0] == "--profile")
                .map(|arguments| arguments[1].as_str())
                .collect();
            assert_eq!(profiles, ["ticketry-run-1"]);
            assert_eq!(
                plan.argv
                    .iter()
                    .filter(|argument| argument.starts_with("mcp_servers="))
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                [
                    r#"mcp_servers={ticketry={args=["mcp","--data-dir","/private/Ticketry Data","--agent-run-id","run-1"],command="/Applications/Ticketry/ticketry-hook",env_vars=["TICKETRY_MCP_AUTHORIZATION"],required=true}}"#
                ]
            );
            assert_eq!(
                plan.environment
                    .get("TICKETRY_MCP_AUTHORIZATION")
                    .map(String::as_str),
                Some("Bearer secret-mcp")
            );
            assert!(!plan.argv.iter().any(|argument| argument == "work"));
            assert_eq!(plan.argv[0], "/approved/codex");
            if matches!(kind, LaunchKind::Resume { .. }) {
                assert_eq!(plan.argv[1], "resume");
                assert_eq!(plan.argv.last().unwrap(), "thread-1");
            } else {
                assert_eq!(plan.argv.last().unwrap(), "hello");
            }
        }
    }
}

#[test]
fn codex_profile_injection_preserves_prompt_values_that_look_like_flags() {
    let mut input = durable(LaunchKind::Task, None);
    input.prompt = Some("--profile".into());
    let plan = materialize(&input, &authority()).unwrap();
    assert_eq!(plan.argv.last().unwrap(), "--profile");
    assert!(plan
        .argv
        .windows(2)
        .any(|arguments| arguments == ["--profile", "ticketry-run-1"]));
}

#[test]
fn prepared_codex_profile_does_not_bypass_the_users_profile_validation() {
    for (profile, model) in [("unregistered", None), ("work", Some("gpt-5.4"))] {
        let mut input = durable(LaunchKind::Task, Some(profile));
        input.options.model = model.map(str::to_owned);
        let original = materialize(&input, &unprepared_authority(Provider::Codex)).unwrap_err();
        let prepared = materialize(&input, &authority()).unwrap_err();
        assert_eq!(prepared, original);
        assert_eq!(prepared.code, LaunchPlanningErrorCode::UnsupportedModel);
    }
}

#[test]
fn prepared_codex_profile_preserves_explicit_model_and_effort() {
    let mut input = durable(LaunchKind::Task, None);
    input.options.model = Some("gpt-5.4".into());
    input.options.reasoning = Some("high".into());
    let plan = materialize(&input, &authority()).unwrap();
    assert!(plan
        .argv
        .windows(2)
        .any(|arguments| arguments == ["--model", "gpt-5.4"]));
    assert!(plan
        .argv
        .windows(2)
        .any(|arguments| arguments == ["-c", "model_reasoning_effort=\"high\""]));
    assert!(plan
        .argv
        .windows(2)
        .any(|arguments| arguments == ["--profile", "ticketry-run-1"]));
}

#[test]
fn prepared_codex_profile_leaves_other_provider_launches_unchanged() {
    for provider in [Provider::Claude, Provider::Gemini, Provider::Agy] {
        for kind in [
            LaunchKind::Task,
            LaunchKind::Resume {
                provider_session_id: "session-1".into(),
            },
        ] {
            let mut input = durable(kind, None);
            input.provider = provider;
            let execution = unprepared_authority(provider);
            let original = materialize(&input, &execution).unwrap();
            let prepared =
                materialize(&input, &execution.with_codex_mcp_profile("ticketry-run-1")).unwrap();
            assert_eq!(prepared, original);
        }
    }
}
