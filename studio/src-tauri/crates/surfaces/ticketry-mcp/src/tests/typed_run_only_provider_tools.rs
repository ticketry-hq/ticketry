//! Run-only, sprint and provider tools on the typed path, observed over the
//! socket exactly as an agent sees them. Well-formed sprint suggestions,
//! terminations and Codex renames against the full command database live in
//! the root package's `mcp_acceptance` binary.

use serde_json::{json, Value};

use super::super::allowed_provider_operations;
use super::super::test_support::SocketClient;
use super::{own, prepare_projects, start};

const SPRINT: &str = "60000000-0000-0000-0000-000000000000";

/// The refusal a bearer-less connection receives from every run-only tool.
fn authorization_missing() -> Value {
    json!({"ok": false, "error": "caller_run_unbound", "reason": "authorization_missing"})
}

/// Reviewed contract change (CODING-2745): a global connection used to reach
/// the sprint handlers and fail on the empty global project — `not_found`,
/// `foreign_scope` or a field rejection depending on the arguments. The tools
/// now declare themselves run-only, so every global call gets the one run
/// authorization refusal `terminate_current_run` has always returned, before
/// any argument is read.
#[tokio::test]
async fn global_connections_get_the_run_authorization_refusal_from_run_only_tools() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let suggestion = json!({
        "sprint_id": SPRINT, "goal_id": "goal", "issue_id": "AUTH-1", "reason": "Fits G1."
    });
    for (id, tool, arguments) in [
        (1, "terminate_current_run", json!({})),
        (2, "get_sprint_goals", json!({"sprint_id": SPRINT})),
        (3, "get_sprint_goals", json!({"sprint_id": "not-a-uuid"})),
        (4, "get_sprint_goals", json!({})),
        (5, "suggest_sprint_story", suggestion),
        (6, "suggest_sprint_story", json!({"unexpected": true})),
    ] {
        let refused = global.structured(id, tool, arguments.clone()).await;
        assert_eq!(refused, authorization_missing(), "{tool} {arguments}");
    }

    runtime.shutdown().await;
}

/// The three closed tools publish `additionalProperties: false`; a run's
/// unknown key is now refused before any handler runs instead of being
/// silently ignored. Open tools keep ignoring unknown keys.
#[tokio::test]
async fn closed_sprint_tools_refuse_unknown_keys_as_field_rejections() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    let mut run =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;

    for (id, tool, arguments) in [
        (
            1,
            "get_sprint_goals",
            json!({"sprint_id": SPRINT, "unexpected": 1}),
        ),
        (
            2,
            "suggest_sprint_story",
            json!({
                "sprint_id": SPRINT, "goal_id": "goal", "issue_id": "AUTH-1",
                "reason": "Fits G1.", "unexpected": 1
            }),
        ),
    ] {
        let response = run.call(id, tool, arguments.clone()).await;
        assert!(response.get("error").is_none(), "{tool}: {response:#}");
        let rejection = &response["result"]["structuredContent"];
        assert_eq!(rejection["ok"], false, "{tool}: {response:#}");
        assert_eq!(rejection["code"], "validation", "{tool}: {response:#}");
        assert_eq!(rejection["field"], "unexpected", "{tool}: {response:#}");
    }

    runtime.shutdown().await;
}

/// `rename_codex_thread` keeps its own refusal vocabulary for every malformed
/// input, unknown keys included, and needs no database scope: a global
/// connection reaches the provider exactly as a run does.
#[tokio::test]
async fn rename_codex_thread_keeps_its_invalid_input_shape_and_trimming() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let mut global = SocketClient::connect_global(runtime.socket_path()).await;

    let invalid = |detail: &str| json!({"ok": false, "error": "invalid_input", "detail": detail});
    for (id, arguments, expected) in [
        (
            1,
            json!({"name": "Ship it"}),
            invalid("thread_id must be a non-blank string."),
        ),
        (
            2,
            json!({"thread_id": 7, "name": "Ship it"}),
            invalid("thread_id must be a non-blank string."),
        ),
        (
            3,
            json!({"thread_id": "  ", "name": "Ship it"}),
            invalid("thread_id must be a non-blank string."),
        ),
        (
            4,
            json!({"thread_id": "thread-1"}),
            invalid("name must be a non-blank string."),
        ),
        (
            5,
            json!({"thread_id": "thread-1", "name": null}),
            invalid("name must be a non-blank string."),
        ),
        (
            6,
            json!({"thread_id": "thread-1", "name": " \t"}),
            invalid("name must be a non-blank string."),
        ),
        (
            7,
            json!({"thread_id": "thread-1", "name": "Ship it", "unexpected": true}),
            invalid("unexpected is not a rename_codex_thread argument."),
        ),
    ] {
        let refused = global
            .structured(id, "rename_codex_thread", arguments.clone())
            .await;
        assert_eq!(refused, expected, "{arguments}");
    }

    // This listener was started without the resident app-server, so a
    // well-formed rename reaches the provider seam and reports it missing.
    let unavailable = global
        .structured(
            8,
            "rename_codex_thread",
            json!({"thread_id": "  thread-1 ", "name": "  Ship  it "}),
        )
        .await;
    assert_eq!(
        unavailable["error"], "codex_app_server_unavailable",
        "{unavailable:#}"
    );

    runtime.shutdown().await;
}
