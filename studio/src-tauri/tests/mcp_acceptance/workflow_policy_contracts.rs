//! Defaults, optional permissions and the omitted / null / value contract of
//! the issue-type workflow-policy tools, against the full command database.
//! Scope and malformed arguments are covered by the `ticketry-mcp` crate.

use std::sync::Arc;

use sea_orm::{ConnectionTrait, Database, DbBackend, Schema};
use serde_json::{json, Value};

use super::{
    launch_binding_for, prepare_command_database, MissingTerminalRuntime, BACKLOG, REVIEW,
    TASK_TYPE,
};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient};

async fn run_client(directory: &tempfile::TempDir) -> (McpRuntime, SocketClient) {
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    let client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;
    (runtime, client)
}

/// One Codex model, one reasoning level and two Codex profiles the upsert can
/// resolve by name.
async fn add_model_catalog(directory: &tempfile::TempDir) {
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    ticketry_work_management::launch_binding_stage_skills_migration::install(&database)
        .await
        .unwrap();
    let schema = Schema::new(DbBackend::Sqlite);
    for table in [
        schema.create_table_from_entity(ticketry_entities::agent_model::Entity),
        schema.create_table_from_entity(ticketry_entities::reasoning_level::Entity),
        schema.create_table_from_entity(ticketry_entities::agent_model_reasoning_level::Entity),
    ] {
        database
            .execute_raw(DbBackend::Sqlite.build(&table))
            .await
            .unwrap();
    }
    database
        .execute_unprepared(
            "INSERT INTO worktracker_agentmodel (id, provider_id, name) VALUES
                ('70000000000000000000000000000001', '50000000000000000000000000000001', 'gpt-fixture');
             INSERT INTO worktracker_reasoninglevel (id, name) VALUES
                ('80000000000000000000000000000001', 'high');
             INSERT INTO worktracker_agentmodelreasoninglevel
                (id, agent_model_id, reasoning_level_id) VALUES
                (1, '70000000000000000000000000000001', '80000000000000000000000000000001');
             UPDATE app_settings
                SET value = '{\"global_default\":{\"provider\":\"codex\",\"model\":null,\"reasoning\":null},\"codex_profiles\":[\"fast\",\"deep\"]}'
                WHERE scope = 'host' AND \"key\" = 'provider_catalog';",
        )
        .await
        .unwrap();
    database.close().await.unwrap();
}

#[tokio::test]
async fn transition_defaults_apply_and_permission_booleans_patch_independently() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let (runtime, mut client) = run_client(&directory).await;

    let added = client
        .structured(
            1,
            "add_issue_type_workflow_transition",
            json!({
                "type_id": TASK_TYPE, "from_state_id": BACKLOG, "to_state_id": REVIEW,
                "workflow_revision": 0
            }),
        )
        .await;
    assert_eq!(added["workflow_revision"], 1, "{added:#}");
    assert_eq!(
        added["transitions"],
        json!([{"from_state_id": BACKLOG, "to_state_id": REVIEW, "agent_allowed": true, "handoff": false}])
    );

    let permission = |revision: i64, patch: Value| {
        let mut arguments = json!({
            "type_id": TASK_TYPE, "from_state_id": BACKLOG, "to_state_id": REVIEW,
            "workflow_revision": revision
        });
        arguments
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        arguments
    };
    let tool = "set_issue_type_workflow_transition_permission";
    let handoff = client
        .structured(2, tool, permission(1, json!({"handoff": true})))
        .await;
    assert_eq!(
        handoff["transitions"][0],
        json!({"from_state_id": BACKLOG, "to_state_id": REVIEW, "agent_allowed": true, "handoff": true}),
        "{handoff:#}"
    );
    let revision = handoff["workflow_revision"].as_i64().unwrap();
    let agent = client
        .structured(
            3,
            tool,
            permission(revision, json!({"agent_allowed": false})),
        )
        .await;
    assert_eq!(
        agent["transitions"][0],
        json!({"from_state_id": BACKLOG, "to_state_id": REVIEW, "agent_allowed": false, "handoff": true}),
        "{agent:#}"
    );
    let revision = agent["workflow_revision"].as_i64().unwrap();
    // Omitting both booleans is a patch that changes nothing, which the
    // workflow command refuses.
    let untouched = client
        .structured(4, tool, permission(revision, json!({})))
        .await;
    assert_eq!(untouched["code"], "validation", "{untouched:#}");

    let started = client
        .structured(
            5,
            "set_issue_type_workflow_start_state",
            json!({"type_id": TASK_TYPE, "state_id": REVIEW, "workflow_revision": revision}),
        )
        .await;
    assert_eq!(started["start_state_id"], REVIEW, "{started:#}");
    let stale = client
        .structured(
            6,
            "set_issue_type_workflow_start_state",
            json!({"type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 0}),
        )
        .await;
    assert_eq!(stale["code"], "stale_revision", "{stale:#}");

    runtime.shutdown().await;
}

#[tokio::test]
async fn launch_binding_patch_fields_keep_omitted_null_and_value_distinct() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    add_model_catalog(&directory).await;
    let (runtime, mut client) = run_client(&directory).await;

    let mut revision = 0;
    let mut id = 0;
    let mut upsert = |state: &str, patch: Value, revision: i64| {
        id += 1;
        let mut arguments =
            json!({"type_id": TASK_TYPE, "state_id": state, "workflow_revision": revision});
        arguments
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        (id, arguments)
    };
    let tool = "upsert_issue_type_workflow_launch_binding";

    let (call, arguments) = upsert(
        BACKLOG,
        json!({
            "prompt": "Implement this item", "agent": "codex", "model": "gpt-fixture",
            "reasoning": "high", "required_skills": ["tdd"], "stage_skills": ["review-skill"]
        }),
        revision,
    );
    let set = client.structured(call, tool, arguments).await;
    revision = set["workflow_revision"]
        .as_i64()
        .unwrap_or_else(|| panic!("{set:#}"));
    let mut current = json!({
        "state_id": BACKLOG, "prompt": "Implement this item", "agent": "codex",
        "profile": null, "model": "gpt-fixture", "reasoning": "high",
        "required_skills": ["tdd"], "stage_skills": ["review-skill"],
        "auto_start": false, "subtree_run_enabled": false
    });
    assert_eq!(launch_binding_for(&set, BACKLOG), &current, "{set:#}");

    // Omitting every patch field changes nothing.
    let (call, arguments) = upsert(BACKLOG, json!({}), revision);
    let omitted = client.structured(call, tool, arguments).await;
    assert_eq!(omitted["workflow_revision"], revision, "{omitted:#}");
    assert_eq!(
        launch_binding_for(&omitted, BACKLOG),
        &current,
        "{omitted:#}"
    );

    // Each value changes only its own field.
    for (field, value) in [
        ("prompt", json!("Review it")),
        ("required_skills", json!(["code-review"])),
        ("stage_skills", json!(["tdd"])),
    ] {
        let (call, arguments) = upsert(BACKLOG, json!({field: value}), revision);
        let changed = client.structured(call, tool, arguments).await;
        revision = changed["workflow_revision"]
            .as_i64()
            .unwrap_or_else(|| panic!("{field}: {changed:#}"));
        current[field] = value;
        assert_eq!(
            launch_binding_for(&changed, BACKLOG),
            &current,
            "{field}: {changed:#}"
        );
    }

    // Null clears the nullable fields and leaves the rest alone.
    for (field, cleared) in [
        ("stage_skills", json!([])),
        ("reasoning", json!(null)),
        ("model", json!(null)),
    ] {
        let (call, arguments) = upsert(BACKLOG, json!({field: null}), revision);
        let changed = client.structured(call, tool, arguments).await;
        revision = changed["workflow_revision"]
            .as_i64()
            .unwrap_or_else(|| panic!("{field}: {changed:#}"));
        current[field] = cleared;
        if field == "model" {
            // The binding's agent is derived from its model.
            current["agent"] = json!(null);
        }
        assert_eq!(
            launch_binding_for(&changed, BACKLOG),
            &current,
            "{field}: {changed:#}"
        );
    }

    // Null is refused where the binding requires a value, and nothing is written.
    for field in ["prompt", "required_skills"] {
        let (call, arguments) = upsert(BACKLOG, json!({field: null}), revision);
        let refused = client.structured(call, tool, arguments).await;
        assert_eq!(refused["code"], "field_validation", "{field}: {refused:#}");
        assert_eq!(refused["field"], field, "{field}: {refused:#}");
    }

    // A Codex profile excludes model and reasoning, so it patches on its own
    // binding: value, omitted, another value, then null.
    for (patch, expected) in [
        (
            json!({"prompt": "Profiled", "profile": "fast"}),
            json!("fast"),
        ),
        (json!({}), json!("fast")),
        (json!({"profile": "deep"}), json!("deep")),
        (json!({"profile": null}), json!(null)),
    ] {
        let (call, arguments) = upsert(REVIEW, patch.clone(), revision);
        let changed = client.structured(call, tool, arguments).await;
        revision = changed["workflow_revision"]
            .as_i64()
            .unwrap_or_else(|| panic!("{patch}: {changed:#}"));
        let binding = launch_binding_for(&changed, REVIEW);
        assert_eq!(binding["profile"], expected, "{patch}: {changed:#}");
        assert_eq!(binding["prompt"], "Profiled", "{patch}: {changed:#}");
    }

    let settings = client
        .structured(
            99,
            "get_issue_type_workflow_settings",
            json!({"type_id": TASK_TYPE}),
        )
        .await;
    assert_eq!(settings["workflow_revision"], revision, "{settings:#}");
    assert_eq!(launch_binding_for(&settings, BACKLOG), &current);

    runtime.shutdown().await;
}

#[tokio::test]
async fn a_launch_profile_named_with_a_non_codex_agent_is_refused() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    database
        .execute_unprepared(
            "INSERT INTO worktracker_provider VALUES ('50000000000000000000000000000003', 'claude', 1, 1);",
        )
        .await
        .unwrap();
    database.close().await.unwrap();
    add_model_catalog(&directory).await;
    let (runtime, mut client) = run_client(&directory).await;

    let refused = client
        .structured(
            1,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 0,
                "prompt": "Go", "agent": "claude", "profile": "fast"
            }),
        )
        .await;
    assert_eq!(refused["code"], "incompatible_profile", "{refused:#}");
    assert_eq!(refused["field"], "profile", "{refused:#}");

    // A null agent is the same as an omitted one: no provider narrows the
    // profile, and unpublished `entry_skill` is ignored.
    let accepted = client
        .structured(
            2,
            "upsert_issue_type_workflow_launch_binding",
            json!({
                "type_id": TASK_TYPE, "state_id": BACKLOG, "workflow_revision": 0,
                "prompt": "Go", "agent": null, "profile": "fast", "entry_skill": "tdd"
            }),
        )
        .await;
    assert_eq!(accepted["workflow_revision"], 1, "{accepted:#}");
    assert_eq!(launch_binding_for(&accepted, BACKLOG)["profile"], "fast");

    runtime.shutdown().await;
}
