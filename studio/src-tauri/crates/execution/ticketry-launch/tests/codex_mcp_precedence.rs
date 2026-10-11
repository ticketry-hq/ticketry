//! Exercise the real Codex config loader with Ticketry's public generated artifacts.
use std::{collections::BTreeSet, fs, process::Command};

use ticketry_launch::{
    materialize, DurableLaunchMaterial, ExecutionAuthority, LaunchKind, Provider, ProviderOptions,
    WorkspaceIdentity,
};

#[test]
#[ignore = "requires installed codex-cli 0.162.0; uses disposable CODEX_HOME"]
fn generated_fresh_and_resume_mcp_configuration_replaces_global_fields() {
    let version = Command::new("codex").arg("--version").output().unwrap();
    assert!(version.status.success());
    assert_eq!(
        String::from_utf8(version.stdout).unwrap().trim(),
        "codex-cli 0.162.0"
    );
    let home = tempfile::tempdir().unwrap();
    let run_id = "019e9428-9788-7df0-84cd-755e1b776245";
    for global_transport in [
        "command = '/global/ticketry-hook'\nargs = ['mcp', '--global']\ncwd = '/global/cwd'\nenv = { GLOBAL_MARKER = 'global-value' }\nenv_vars = ['GLOBAL_MARKER']",
        "url = 'https://global.invalid/mcp'\nhttp_headers = { GLOBAL_MARKER = 'global-value' }",
    ] {
        let original = format!(
            "[mcp_servers.ticketry]\n{global_transport}\nenabled = false\nstartup_timeout_sec = 1\ntool_timeout_sec = 2\n[mcp_servers.other]\ncommand = '/other/command'\n"
        );
        fs::write(home.path().join("config.toml"), &original).unwrap();
        let selected = "model = 'profile-model'\n[mcp_servers.ticketry]\ncommand = '/profile/hook'\nenv = { PROFILE_MARKER = 'profile-value' }\n[mcp_servers.profile_other]\ncommand = '/profile/other'\n";
        fs::write(home.path().join("work.config.toml"), selected).unwrap();
        fs::write(home.path().join("auth.json"), "synthetic-auth-marker").unwrap();
        for profile in [None, Some("work")] {
            let prepared = ticketry_provider::prepare_codex_run_mcp_profile(
                run_id, profile, Some(home.path()),
            ).unwrap();
            for kind in [LaunchKind::Task, LaunchKind::Resume { provider_session_id: "thread-1".into() }] {
                let durable = DurableLaunchMaterial::new(
                    run_id, kind, Provider::Codex,
                    ProviderOptions { profile: profile.map(str::to_owned), ..ProviderOptions::default() },
                    Some("hello".into()), Vec::new(),
                    WorkspaceIdentity::Scratch { project_id: "project".into(), module_id: "module".into(), agent_run_id: run_id.into() }, None,
                );
                let authority = ExecutionAuthority::new(
                    "/approved/codex".into(), home.path().into(),
                    "/Applications/Ticketry App/ticketry-hook".into(), "/private/spool".into(),
                    "/private/Ticketry Data".into(), "Bearer synthetic-test".into(), BTreeSet::new(), vec!["work".into()],
                ).with_codex_mcp_profile(&prepared);
                let launch = materialize(&durable, &authority).unwrap();
                let generated_profile = launch.argv.windows(2).find(|pair| pair[0] == "--profile").unwrap();
                let generated_override = launch.argv.iter().find(|arg| arg.starts_with("mcp_servers=")).unwrap();
                let output = Command::new("codex")
                    .env("CODEX_HOME", home.path()).current_dir(home.path())
                    .args(["--profile", &generated_profile[1], "-c", generated_override, "mcp", "list", "--json"])
                    .output().unwrap();
                assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
                let servers: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
                let servers = servers.as_array().unwrap();
                let run = servers.iter().find(|server| server["name"] == "ticketry").unwrap();
                assert_eq!(run["transport"]["type"], "stdio");
                assert_eq!(run["transport"]["command"], "/Applications/Ticketry App/ticketry-hook");
                assert_eq!(run["transport"]["args"], serde_json::json!(["mcp", "--data-dir", "/private/Ticketry Data", "--agent-run-id", run_id]));
                assert!(run["transport"]["env"].is_null() || run["transport"]["env"] == serde_json::json!({}));
                assert!(run["transport"]["cwd"].is_null());
                assert_eq!(run["transport"]["env_vars"], serde_json::json!(["TICKETRY_MCP_AUTHORIZATION"]));
                assert_eq!(run["enabled"], true);
                assert!(run["startup_timeout_sec"].is_null());
                assert!(run["tool_timeout_sec"].is_null());
                assert!(servers.iter().any(|server| server["name"] == "other" && server["transport"]["command"] == "/other/command"));
                assert_eq!(servers.iter().any(|server| server["name"] == "profile_other"), profile.is_some());
                println!("generated profile {prepared}; effective run server {run}");
            }
        }
        assert_eq!(fs::read_to_string(home.path().join("config.toml")).unwrap(), original);
        assert_eq!(fs::read_to_string(home.path().join("work.config.toml")).unwrap(), selected);
        assert_eq!(fs::read_to_string(home.path().join("auth.json")).unwrap(), "synthetic-auth-marker");
    }
}
