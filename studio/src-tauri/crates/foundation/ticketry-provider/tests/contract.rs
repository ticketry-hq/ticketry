use std::collections::BTreeSet;
use std::path::Path;

use ticketry_provider::{
    provider_contract, CatalogRefreshPolicy, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, LaunchConstructionRequest, ProfileSelection, Provider,
    ProviderErrorCode, ProviderLaunch, ProviderLaunchKind, ProviderOptions,
};

#[test]
fn registered_providers_publish_the_shipping_installation_catalog() {
    let actual = Provider::ALL
        .into_iter()
        .map(|provider| {
            let contract = provider_contract(provider);
            let catalog = contract.installation_catalog();
            (
                contract.metadata().slug,
                contract.metadata().settings_configurable,
                contract.metadata().supports_unattended,
                catalog.active_by_default,
                catalog.default_model,
                catalog.default_effort,
                catalog
                    .models
                    .iter()
                    .map(|model| (model.name, model.efforts))
                    .collect::<Vec<_>>(),
                contract.refresh_policy(),
            )
        })
        .collect::<Vec<_>>();

    assert_eq!(
        actual,
        vec![
            (
                "claude",
                true,
                true,
                true,
                None,
                None,
                vec![
                    ("sonnet", &["low", "medium", "high", "xhigh", "max"][..]),
                    ("opus", &["low", "medium", "high", "xhigh", "max"][..]),
                    ("haiku", &["low", "medium", "high", "xhigh", "max"][..]),
                    ("fable", &["low", "medium", "high", "xhigh", "max"][..]),
                ],
                CatalogRefreshPolicy::PersistedDatabase,
            ),
            (
                "codex",
                true,
                true,
                true,
                None,
                None,
                vec![(
                    "gpt-5.4",
                    &["minimal", "low", "medium", "high", "xhigh"][..]
                )],
                CatalogRefreshPolicy::PersistedDatabase,
            ),
            (
                "gemini",
                true,
                true,
                true,
                None,
                None,
                vec![("gemini-3.1-pro-preview", &[][..])],
                CatalogRefreshPolicy::PersistedDatabase,
            ),
            (
                "agy",
                false,
                true,
                false,
                None,
                None,
                vec![("vendor/model", &[][..])],
                CatalogRefreshPolicy::PersistedDatabase,
            ),
        ]
    );
}

#[test]
fn inventory_lookup_efforts_and_profiles_share_one_contract() {
    let slugs = Provider::ALL
        .into_iter()
        .map(Provider::slug)
        .collect::<BTreeSet<_>>();
    assert_eq!(slugs, BTreeSet::from(["agy", "claude", "codex", "gemini"]));
    for provider in Provider::ALL {
        assert_eq!(Provider::try_from(provider.slug()).unwrap(), provider);
    }
    assert_eq!(
        Provider::try_from("future").unwrap_err().code,
        ProviderErrorCode::UnknownProvider
    );

    let codex = provider_contract(Provider::Codex);
    assert!(codex.profile_defaults().is_empty());
    assert_eq!(
        codex.efforts_for_model("gpt-5.4"),
        Some(&["minimal", "low", "medium", "high", "xhigh"][..])
    );
    assert_eq!(codex.efforts_for_model("custom"), None);
    assert_eq!(
        codex
            .normalize_profiles(&[" work ".into(), "".into(), "work".into()])
            .unwrap(),
        vec!["work"]
    );
    codex
        .validate_profile_selection(
            ProfileSelection {
                profile: Some("work"),
                model: None,
                effort: None,
            },
            &["work".into()],
        )
        .unwrap();
    assert_eq!(
        codex
            .validate_profile_selection(
                ProfileSelection {
                    profile: Some("work"),
                    model: Some("gpt-5.4"),
                    effort: None,
                },
                &["work".into()],
            )
            .unwrap_err()
            .code,
        ProviderErrorCode::ProfileConflict
    );
    assert_eq!(
        provider_contract(Provider::Claude)
            .validate_profile_selection(
                ProfileSelection {
                    profile: Some("work"),
                    model: None,
                    effort: None,
                },
                &[],
            )
            .unwrap_err()
            .code,
        ProviderErrorCode::UnsupportedProfile
    );
}

#[test]
fn every_provider_has_explicit_launch_and_trust_behavior() {
    let workspace = tempfile::tempdir().unwrap();
    let executable = workspace.path().join("codex");
    let profiles = vec!["work".to_owned()];
    let codex = provider_contract(Provider::Codex);
    let launch = codex
        .construct_launch(&LaunchConstructionRequest {
            executable: &executable,
            working_directory: workspace.path(),
            kind: ProviderLaunchKind::Fresh,
            agent_run_id: "run",
            prompt: Some("ship it"),
            options: ProviderOptions {
                profile: Some("work"),
                model: None,
                effort: None,
            },
            registered_profiles: &profiles,
            hook_command: "/bin/hook",
            mcp_server: serde_json::json!({"command": "/bin/mcp"}),
        })
        .unwrap();
    assert!(launch
        .argv
        .windows(2)
        .any(|pair| pair == ["--profile", "work"]));
    assert_eq!(launch.working_directory, workspace.path());
    assert!(codex.launch_metadata().supports_resume);

    for provider in Provider::ALL {
        let executable = workspace.path().join(provider.slug());
        let contract = provider_contract(provider);
        let launch = contract
            .construct_launch(&LaunchConstructionRequest {
                executable: &executable,
                working_directory: workspace.path(),
                kind: ProviderLaunchKind::Fresh,
                agent_run_id: "run",
                prompt: Some("ship it"),
                options: ProviderOptions::default(),
                registered_profiles: &[],
                hook_command: "/bin/hook",
                mcp_server: serde_json::json!({"command": "/bin/mcp"}),
            })
            .unwrap();
        assert_eq!(launch.argv.first().unwrap(), executable.to_str().unwrap());
        assert_eq!(launch.working_directory, workspace.path());

        let resumed = contract
            .construct_launch(&LaunchConstructionRequest {
                executable: &executable,
                working_directory: workspace.path(),
                kind: ProviderLaunchKind::Resume {
                    provider_session_id: "conversation",
                },
                agent_run_id: "run",
                prompt: None,
                options: ProviderOptions::default(),
                registered_profiles: &[],
                hook_command: "/bin/hook",
                mcp_server: serde_json::json!({"command": "/bin/mcp"}),
            })
            .unwrap();
        assert!(resumed
            .argv
            .iter()
            .any(|argument| argument == "conversation"));
    }

    assert_eq!(
        provider_contract(Provider::Agy).inspect_directory_trust(DirectoryTrustContext {
            directory: workspace.path(),
            trust_file: None,
            executable: None,
        }),
        DirectoryTrustInspection::Unsupported
    );
    assert!(matches!(
        provider_contract(Provider::Claude).inspect_directory_trust(DirectoryTrustContext {
            directory: workspace.path(),
            trust_file: Some(&workspace.path().join("claude.json")),
            executable: None,
        }),
        DirectoryTrustInspection::ApprovalRequired(_)
    ));

    let trust_file = workspace.path().join("trustedFolders.json");
    let gemini = provider_contract(Provider::Gemini);
    let context = DirectoryTrustContext {
        directory: workspace.path(),
        trust_file: Some(&trust_file),
        executable: None,
    };
    let DirectoryTrustInspection::ApprovalRequired(approval) =
        gemini.inspect_directory_trust(context)
    else {
        panic!("unconfigured Gemini directory requires approval");
    };
    assert_eq!(
        gemini.prepare_directory_trust(context, None),
        DirectoryTrustPreparation::ApprovalRequired
    );
    assert!(!trust_file.exists());
    assert_eq!(
        gemini.prepare_directory_trust(context, Some(&approval)),
        DirectoryTrustPreparation::Prepared
    );
    assert_eq!(
        gemini.inspect_directory_trust(context),
        DirectoryTrustInspection::Trusted
    );

    let denied_directory = workspace.path().join("denied");
    std::fs::create_dir(&denied_directory).unwrap();
    let denied_rules = serde_json::Map::from_iter([(
        denied_directory.to_str().unwrap().to_owned(),
        serde_json::Value::String("DO_NOT_TRUST".to_owned()),
    )]);
    std::fs::write(&trust_file, serde_json::to_vec(&denied_rules).unwrap()).unwrap();
    assert_eq!(
        gemini.inspect_directory_trust(DirectoryTrustContext {
            directory: &denied_directory,
            trust_file: Some(&trust_file),
            executable: None,
        }),
        DirectoryTrustInspection::Denied
    );
}

#[test]
fn every_provider_preserves_fresh_resume_configuration_and_cwd() {
    let workspace = tempfile::tempdir().unwrap();
    let mcp = serde_json::json!({"command": "/bin/mcp"});
    let cases = [
        (
            Provider::Claude,
            ProviderOptions {
                profile: None,
                model: Some("sonnet"),
                effort: Some("high"),
            },
            &[
                "--permission-mode",
                "auto",
                "--model",
                "sonnet",
                "--effort",
                "high",
                "ship it",
            ][..],
            &["--permission-mode", "auto", "--resume", "conversation"][..],
        ),
        (
            Provider::Codex,
            ProviderOptions {
                profile: None,
                model: Some("gpt-5.4"),
                effort: Some("xhigh"),
            },
            &[
                "--model",
                "gpt-5.4",
                "-c",
                "model_reasoning_effort=\"xhigh\"",
                "ship it",
            ][..],
            &["conversation"][..],
        ),
        (
            Provider::Gemini,
            ProviderOptions {
                profile: None,
                model: Some("gemini-3.1-pro-preview"),
                effort: None,
            },
            &[
                "--skip-trust",
                "--approval-mode",
                "yolo",
                "--model",
                "gemini-3.1-pro-preview",
                "ship it",
            ][..],
            &[
                "--skip-trust",
                "--approval-mode",
                "yolo",
                "--resume",
                "conversation",
            ][..],
        ),
        (
            Provider::Agy,
            ProviderOptions {
                profile: None,
                model: Some("vendor/model"),
                effort: None,
            },
            &[
                "--dangerously-skip-permissions",
                "--model",
                "vendor/model",
                "-i",
                "ship it",
            ][..],
            &[
                "--dangerously-skip-permissions",
                "--conversation",
                "conversation",
            ][..],
        ),
    ];

    for (provider, options, fresh_tail, resume_tail) in cases {
        let executable = workspace.path().join(provider.slug());
        let contract = provider_contract(provider);
        let fresh = contract
            .construct_launch(&LaunchConstructionRequest {
                executable: &executable,
                working_directory: workspace.path(),
                kind: ProviderLaunchKind::Fresh,
                agent_run_id: "run",
                prompt: Some("ship it"),
                options,
                registered_profiles: &[],
                hook_command: "/bin/hook",
                mcp_server: mcp.clone(),
            })
            .unwrap();
        let resumed = contract
            .construct_launch(&LaunchConstructionRequest {
                executable: &executable,
                working_directory: workspace.path(),
                kind: ProviderLaunchKind::Resume {
                    provider_session_id: "conversation",
                },
                agent_run_id: "run",
                prompt: Some("ignored"),
                options,
                registered_profiles: &[],
                hook_command: "/bin/hook",
                mcp_server: mcp.clone(),
            })
            .unwrap();

        assert_eq!(fresh.working_directory, workspace.path());
        assert_eq!(resumed.working_directory, workspace.path());
        assert!(
            fresh.argv.ends_with(&strings(fresh_tail)),
            "{:?}",
            fresh.argv
        );
        assert!(
            resumed.argv.ends_with(&strings(resume_tail)),
            "{:?}",
            resumed.argv
        );
        assert!(!resumed.argv.iter().any(|value| value == "ignored"));
        assert_provider_configuration(provider, &fresh);
        assert_provider_configuration(provider, &resumed);
    }
}

#[test]
fn every_provider_rejects_invalid_and_unsupported_selections() {
    let workspace = tempfile::tempdir().unwrap();
    let profiles = vec!["work".to_owned()];
    let selection = |profile, model, effort| ProfileSelection {
        profile,
        model,
        effort,
    };
    let codex = provider_contract(Provider::Codex);
    for (selected, expected) in [
        (
            selection(Some(" "), None, None),
            ProviderErrorCode::InvalidProfile,
        ),
        (
            selection(Some("missing"), None, None),
            ProviderErrorCode::UnregisteredProfile,
        ),
        (
            selection(Some("work"), Some("gpt-5.4"), None),
            ProviderErrorCode::ProfileConflict,
        ),
        (
            selection(Some("work"), None, Some("high")),
            ProviderErrorCode::ProfileConflict,
        ),
    ] {
        assert_eq!(
            codex
                .validate_profile_selection(selected, &profiles)
                .unwrap_err()
                .code,
            expected
        );
    }
    for provider in [Provider::Claude, Provider::Gemini, Provider::Agy] {
        assert_eq!(
            provider_contract(provider)
                .validate_profile_selection(selection(Some("work"), None, None), &profiles)
                .unwrap_err()
                .code,
            ProviderErrorCode::UnsupportedProfile
        );
    }

    for provider in Provider::ALL {
        let executable = workspace.path().join(provider.slug());
        assert_eq!(
            provider_contract(provider)
                .construct_launch(&launch_request(
                    &executable,
                    ProviderLaunchKind::Fresh,
                    workspace.path(),
                    ProviderOptions {
                        model: Some("bad value"),
                        ..ProviderOptions::default()
                    },
                    &profiles,
                ))
                .unwrap_err()
                .code,
            ProviderErrorCode::UnsupportedModel
        );
        assert_eq!(
            provider_contract(provider)
                .construct_launch(&launch_request(
                    &executable,
                    ProviderLaunchKind::Resume {
                        provider_session_id: "",
                    },
                    workspace.path(),
                    ProviderOptions::default(),
                    &profiles,
                ))
                .unwrap_err()
                .code,
            ProviderErrorCode::InvalidResumeIdentity
        );
        assert_eq!(
            provider_contract(provider)
                .construct_launch(&launch_request(
                    &executable,
                    ProviderLaunchKind::Fresh,
                    std::path::Path::new("relative"),
                    ProviderOptions::default(),
                    &profiles,
                ))
                .unwrap_err()
                .code,
            ProviderErrorCode::InvalidLaunchInput
        );
    }

    for provider in [Provider::Gemini, Provider::Agy] {
        let executable = workspace.path().join(provider.slug());
        assert_eq!(
            provider_contract(provider)
                .construct_launch(&LaunchConstructionRequest {
                    executable: &executable,
                    working_directory: workspace.path(),
                    kind: ProviderLaunchKind::Fresh,
                    agent_run_id: "run",
                    prompt: None,
                    options: ProviderOptions {
                        effort: Some("high"),
                        ..ProviderOptions::default()
                    },
                    registered_profiles: &[],
                    hook_command: "/bin/hook",
                    mcp_server: serde_json::json!({}),
                })
                .unwrap_err()
                .code,
            ProviderErrorCode::UnsupportedEffort
        );
    }
}

fn launch_request<'a>(
    executable: &'a Path,
    kind: ProviderLaunchKind<'a>,
    working_directory: &'a Path,
    options: ProviderOptions<'a>,
    profiles: &'a [String],
) -> LaunchConstructionRequest<'a> {
    LaunchConstructionRequest {
        executable,
        working_directory,
        kind,
        agent_run_id: "run",
        prompt: Some("ship it"),
        options,
        registered_profiles: profiles,
        hook_command: "/bin/hook",
        mcp_server: serde_json::json!({}),
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn assert_provider_configuration(provider: Provider, launch: &ProviderLaunch) {
    let (events, timeout) = match provider {
        Provider::Claude => (
            &[
                "SessionStart",
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUse",
                "Notification",
                "PermissionRequest",
                "Stop",
                "SessionEnd",
            ][..],
            5,
        ),
        Provider::Codex => (
            &[
                "SessionStart",
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUse",
                "PermissionRequest",
                "Stop",
            ][..],
            5,
        ),
        Provider::Gemini => (
            &[
                "SessionStart",
                "BeforeAgent",
                "BeforeTool",
                "AfterTool",
                "Notification",
                "AfterAgent",
                "SessionEnd",
            ][..],
            5_000,
        ),
        Provider::Agy => (
            &[
                "SessionStart",
                "PreToolUse",
                "PostToolUse",
                "Notification",
                "Stop",
                "SessionEnd",
            ][..],
            5_000,
        ),
    };
    let hook = serde_json::json!({"hooks": [{"type": "command", "command": "/bin/hook", "timeout": timeout}]});
    let hooks = serde_json::Map::from_iter(
        events
            .iter()
            .map(|event| ((*event).to_owned(), serde_json::json!([hook.clone()]))),
    );

    match provider {
        Provider::Claude => {
            let settings = launch
                .argv
                .iter()
                .position(|value| value == "--settings")
                .unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&launch.argv[settings + 1]).unwrap(),
                serde_json::json!({"env": {"MUXED_AGENT_RUN_ID": "run"}, "hooks": hooks})
            );
            let mcp = launch
                .argv
                .iter()
                .position(|value| value == "--mcp-config")
                .unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&launch.argv[mcp + 1]).unwrap(),
                serde_json::json!({"mcpServers": {"ticketry": {"command": "/bin/mcp"}}})
            );
        }
        Provider::Codex => {
            let hooks = launch
                .argv
                .iter()
                .find(|value| value.starts_with("hooks="))
                .unwrap();
            for event in events {
                assert!(hooks.contains(event));
            }
            assert_eq!(hooks.matches("command=\"/bin/hook\"").count(), events.len());
            assert!(launch
                .argv
                .iter()
                .any(|value| value == "mcp_servers={ticketry={command=\"/bin/mcp\"}}"));
            assert!(launch
                .argv
                .iter()
                .any(|value| value == "approvals_reviewer=\"auto_review\""));
            assert!(launch
                .argv
                .iter()
                .any(|value| value == "--dangerously-bypass-hook-trust"));
            assert!(launch.settings.is_none());
        }
        Provider::Gemini | Provider::Agy => {
            let settings = launch.settings.as_ref().unwrap();
            assert_eq!(settings.environment_name, "GEMINI_CLI_SYSTEM_SETTINGS_PATH");
            assert_eq!(
                settings.contents,
                serde_json::json!({"hooks": hooks, "mcpServers": {"ticketry": {"command": "/bin/mcp"}}})
            );
        }
    }
}
