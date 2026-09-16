use super::*;
use serde_json::json;
use std::collections::BTreeSet;

#[test]
fn packaged_stdio_mcp_keeps_credentials_in_environment_for_every_provider() {
    for provider in [
        Provider::Claude,
        Provider::Codex,
        Provider::Gemini,
        Provider::Agy,
    ] {
        for (data_directory, command, codex_config) in [
            (
                "/private/Ticketry Data",
                "/Applications/Ticketry App/ticketry-hook",
                r#"mcp_servers={ticketry={args=["mcp","--data-dir","/private/Ticketry Data","--agent-run-id","run-1"],command="/Applications/Ticketry App/ticketry-hook",env_vars=["TICKETRY_MCP_AUTHORIZATION"]}}"#,
            ),
            (
                "/private/Ticketry \"Data\"\\cache\nnext\trow",
                "/Applications/Ticketry's \"App\"\\build/ticketry-hook",
                r#"mcp_servers={ticketry={args=["mcp","--data-dir","/private/Ticketry \"Data\"\\cache\nnext\trow","--agent-run-id","run-1"],command="/Applications/Ticketry's \"App\"\\build/ticketry-hook",env_vars=["TICKETRY_MCP_AUTHORIZATION"]}}"#,
            ),
        ] {
            let authority = ExecutionAuthority::new(
                format!("/approved/{}", provider_contract(provider).slug).into(),
                "/authorized/workspace".into(),
                command.into(),
                "/private/spool".into(),
                data_directory.into(),
                "Bearer secret-mcp".into(),
                BTreeSet::new(),
                Vec::new(),
            );
            let durable = DurableLaunchMaterial::new(
                "run-1",
                LaunchKind::Task,
                provider,
                ProviderOptions::default(),
                Some("hello".into()),
                Vec::new(),
                WorkspaceIdentity::Scratch {
                    project_id: "project".into(),
                    module_id: "module".into(),
                    agent_run_id: "run-1".into(),
                },
                None,
            );
            let plan = materialize(&durable, &authority).unwrap();
            assert_eq!(
                plan.environment
                    .get("TICKETRY_MCP_AUTHORIZATION")
                    .map(String::as_str),
                Some("Bearer secret-mcp")
            );
            assert!(!format!("{authority:?}").contains("secret-mcp"));
            assert!(!format!("{plan:?}").contains("secret-mcp"));
            assert!(!serde_json::to_string(&durable)
                .unwrap()
                .contains("secret-mcp"));
            assert!(plan
                .argv
                .iter()
                .all(|argument| !argument.contains("secret-mcp")));
            let expected = json!({
                "command": command,
                "args": ["mcp", "--data-dir", data_directory, "--agent-run-id", "run-1"],
                "env": {"TICKETRY_MCP_AUTHORIZATION": "${TICKETRY_MCP_AUTHORIZATION}"},
            });
            match provider {
                Provider::Claude => {
                    let index = plan
                        .argv
                        .iter()
                        .position(|arg| arg == "--mcp-config")
                        .unwrap();
                    let config: serde_json::Value =
                        serde_json::from_str(&plan.argv[index + 1]).unwrap();
                    assert_eq!(config, json!({"mcpServers": {"ticketry": expected}}));
                }
                Provider::Codex => {
                    assert!(
                        plan.argv.iter().any(|arg| arg == codex_config),
                        "escaped stdio configuration missing"
                    );
                }
                Provider::Gemini | Provider::Agy => {
                    let mut expected = expected;
                    expected["trust"] = json!(true);
                    let settings = plan.settings.unwrap();
                    assert_eq!(settings.environment_name, "GEMINI_CLI_SYSTEM_SETTINGS_PATH");
                    assert_eq!(
                        settings.contents["mcpServers"],
                        json!({"ticketry": expected})
                    );
                }
            }
        }
    }
}
