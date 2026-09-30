//! Socket-level coverage for `rename_codex_thread`: the one MCP tool that
//! writes through a provider rather than a Ticketry table.
//!
//! Each case drives the real registry, handshake, authorization, and dispatch
//! against a scripted `codex app-server`, so the assertions cover the exact
//! JSON-RPC Ticketry is allowed to send as well as the structured result the
//! caller sees.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sea_orm::Database;
use serde_json::{json, Value};

use super::{prepare_command_database, MissingTerminalRuntime};
use ticketry_codex_app_server::{CodexAppServerClient, CodexThreadTitles};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient};
use ticketry_terminal::InstantRunTicketTitleService;

/// A `codex app-server` stand-in that keeps one thread name in a file. It
/// answers `initialize`, `thread/name/set`, and `thread/read`, records every
/// launch and every request, and answers nothing else — an ownership method
/// would simply go unanswered.
struct ScriptedAppServer {
    directory: tempfile::TempDir,
    executable: PathBuf,
}

impl ScriptedAppServer {
    /// Accepts every rename and remembers the name a later read returns.
    fn accepting() -> Self {
        Self::new(
            "printf '%s' \"$name\" > \"$state\"; \
             printf '{\"id\":%s,\"result\":{}}\\n' \"$request_id\"",
        )
    }

    /// Answers every rename with the JSON-RPC error Codex reports for a thread
    /// it does not know.
    fn rejecting_unknown_threads() -> Self {
        Self::new(
            "printf '{\"id\":%s,\"error\":{\"code\":-32602,\"message\":\"thread not found\"}}\\n' \
             \"$request_id\"",
        )
    }

    /// Answers every rename with a provider error that names private material,
    /// so the test can prove none of it reaches the caller.
    fn failing_privately() -> Self {
        Self::new(
            "printf '{\"id\":%s,\"error\":{\"code\":-32000,\"message\":\"/private/launch/material \
             refused\"}}\\n' \"$request_id\"",
        )
    }

    fn new(rename_reply: &str) -> Self {
        let directory = tempfile::tempdir().expect("create scripted app-server directory");
        let executable = directory.path().join("codex");
        let script = format!(
            r#"#!/bin/sh
launches='{launches}'
requests='{requests}'
state='{state}'
printf 'launched\n' >> "$launches"
while IFS= read -r request; do
  printf '%s\n' "$request" >> "$requests"
  request_id=$(printf '%s\n' "$request" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  name=$(printf '%s\n' "$request" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
  case "$request" in
    *'"method":"initialize"'*) printf '{{"id":%s,"result":{{}}}}\n' "$request_id" ;;
    *'"method":"thread/name/set"'*) {rename_reply} ;;
    *'"method":"thread/read"'*)
      if [ -f "$state" ]; then stored=$(cat "$state"); else stored=; fi
      printf '{{"id":%s,"result":{{"thread":{{"name":"%s"}}}}}}\n' "$request_id" "$stored" ;;
  esac
done
"#,
            launches = shell_literal(&directory.path().join("launches")),
            requests = shell_literal(&directory.path().join("requests.jsonl")),
            state = shell_literal(&directory.path().join("name")),
            rename_reply = rename_reply,
        );
        fs::write(&executable, script).expect("write scripted app-server");
        let mut permissions = fs::metadata(&executable)
            .expect("read scripted app-server metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&executable, permissions).expect("make scripted app-server executable");
        Self {
            directory,
            executable,
        }
    }

    fn launch_count(&self) -> usize {
        self.read(self.directory.path().join("launches")).len()
    }

    fn requests(&self) -> Vec<Value> {
        self.read(self.directory.path().join("requests.jsonl"))
            .iter()
            .map(|line| serde_json::from_str(line).expect("scripted request is JSON"))
            .collect()
    }

    fn methods(&self) -> Vec<String> {
        self.requests()
            .iter()
            .map(|request| request["method"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    fn read(&self, path: PathBuf) -> Vec<String> {
        fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

fn shell_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "'\"'\"'")
}

fn configuration(directory: &tempfile::TempDir) -> McpConfiguration {
    McpConfiguration {
        database_path: directory.path().join("state.db"),
        media_root: directory.path().join("media"),
    }
}

/// Start the listener against one shared resident client, and hand the test the
/// same allocation so it can read a title back without a second launch.
async fn listener(
    directory: &tempfile::TempDir,
    ownership: &DataDirectoryGuard,
    server: &ScriptedAppServer,
) -> (McpRuntime, Arc<CodexAppServerClient>) {
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .expect("open the scripted acceptance database");
    let client = Arc::new(
        CodexAppServerClient::start(server.executable.clone())
            .await
            .expect("start the scripted app-server"),
    );
    let runtime = McpRuntime::start_for_test_with_codex_titles(
        configuration(directory),
        ownership,
        Arc::new(MissingTerminalRuntime),
        InstantRunTicketTitleService::new(database, client.clone()),
    )
    .await
    .expect("start the in-process MCP listener");
    (runtime, client)
}

async fn authorized(runtime: &McpRuntime, tools: Vec<String>) -> SocketClient {
    let authorization = runtime
        .authority()
        .issue("run-valid", tools)
        .await
        .expect("issue a run grant");
    SocketClient::connect_run(runtime.socket_path(), "run-valid", &authorization).await
}

#[tokio::test]
async fn an_authorized_client_renames_a_thread_through_the_resident_app_server() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let server = ScriptedAppServer::accepting();
    let (runtime, client) = listener(&directory, &ownership, &server).await;
    let mut caller = authorized(&runtime, allowed_provider_operations()).await;

    let renamed = caller
        .structured(
            1,
            "rename_codex_thread",
            json!({"thread_id": "  thread-active  ", "name": "  Ship the  rename  "}),
        )
        .await;

    assert_eq!(
        renamed,
        json!({"ok": true, "thread_id": "thread-active", "name": "Ship the  rename"}),
        "a rename answers with the trimmed values it sent to Codex"
    );
    assert_eq!(
        client.read_thread_title("thread-active").await.unwrap(),
        Some("Ship the  rename".to_owned()),
        "a following read through the same resident client observes the new title"
    );
    assert_eq!(
        server.methods(),
        ["initialize", "thread/name/set", "thread/read"],
        "the acceptance path sends no start, resume, or fork request"
    );
    assert_eq!(
        server.requests()[1]["params"],
        json!({"threadId": "thread-active", "name": "Ship the  rename"})
    );
    assert_eq!(server.launch_count(), 1, "one resident app-server launch");

    runtime.shutdown().await;
}

#[tokio::test]
async fn rename_refusals_stay_structured_and_private() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let server = ScriptedAppServer::accepting();
    let (runtime, _client) = listener(&directory, &ownership, &server).await;
    let mut caller = authorized(&runtime, allowed_provider_operations()).await;

    for (id, arguments) in [
        (1, json!({"thread_id": "   ", "name": "Ship it"})),
        (2, json!({"thread_id": "thread-active", "name": "  "})),
        (3, json!({"thread_id": "thread-active"})),
        (4, json!({"thread_id": 7, "name": "Ship it"})),
    ] {
        let refusal = caller
            .structured(id, "rename_codex_thread", arguments)
            .await;
        assert_eq!(refusal["ok"], json!(false));
        assert_eq!(refusal["error"], json!("invalid_input"));
    }
    assert_eq!(
        server.methods(),
        ["initialize"],
        "malformed input never reaches the app-server"
    );

    let mut unauthorized = authorized(&runtime, vec!["list_projects".to_owned()]).await;
    let refused = unauthorized
        .structured(
            5,
            "rename_codex_thread",
            json!({"thread_id": "thread-active", "name": "Ship it"}),
        )
        .await;
    assert_eq!(
        refused,
        json!({"ok": false, "error": "tool_not_allowed", "reason": "authorization_tool_disallowed"})
    );

    runtime.shutdown().await;
}

#[tokio::test]
async fn an_unknown_thread_and_a_provider_failure_keep_their_own_codes() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let server = ScriptedAppServer::rejecting_unknown_threads();
    let (runtime, _client) = listener(&directory, &ownership, &server).await;
    let mut caller = authorized(&runtime, allowed_provider_operations()).await;

    let refusal = caller
        .structured(
            1,
            "rename_codex_thread",
            json!({"thread_id": "thread-missing", "name": "Ship it"}),
        )
        .await;

    assert_eq!(refusal["ok"], json!(false));
    assert_eq!(refusal["error"], json!("codex_thread_not_found"));
    runtime.shutdown().await;

    let private = tempfile::tempdir().unwrap();
    prepare_command_database(&private).await;
    let private_ownership = DataDirectoryGuard::acquire(private.path()).unwrap();
    let failing = ScriptedAppServer::failing_privately();
    let (runtime, _client) = listener(&private, &private_ownership, &failing).await;
    let mut caller = authorized(&runtime, allowed_provider_operations()).await;

    let refusal = caller
        .structured(
            1,
            "rename_codex_thread",
            json!({"thread_id": "thread-active", "name": "Ship it"}),
        )
        .await;

    assert_eq!(refusal["error"], json!("codex_app_server_error"));
    let rendered = refusal.to_string();
    assert!(
        !rendered.contains("/private/launch/material")
            && !rendered.contains('/')
            && !rendered.contains("Bearer"),
        "a refusal names no launch material, executable path, or credential: {rendered}"
    );

    runtime.shutdown().await;
}

#[tokio::test]
async fn a_listener_without_the_resident_capability_reports_it_unavailable() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        configuration(&directory),
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let mut caller = authorized(&runtime, allowed_provider_operations()).await;

    let refusal = caller
        .structured(
            1,
            "rename_codex_thread",
            json!({"thread_id": "thread-active", "name": "Ship it"}),
        )
        .await;

    assert_eq!(refusal["ok"], json!(false));
    assert_eq!(refusal["error"], json!("codex_app_server_unavailable"));

    runtime.shutdown().await;
}
