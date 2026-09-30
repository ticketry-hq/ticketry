#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sea_orm::{ConnectOptions, ConnectionTrait, Database};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::{adopt_worktracker_and_install, InstallationOwnership};
use ticketry_tool_discovery::{approve_executable_path, SupportedTool};

struct DataDirectoryOverride(Option<std::ffi::OsString>);

impl DataDirectoryOverride {
    fn set(path: &Path) -> Self {
        let previous = std::env::var_os("TICKETRY_DATA_DIR");
        std::env::set_var("TICKETRY_DATA_DIR", path);
        Self(previous)
    }
}

impl Drop for DataDirectoryOverride {
    fn drop(&mut self) {
        match self.0.take() {
            Some(value) => std::env::set_var("TICKETRY_DATA_DIR", value),
            None => std::env::remove_var("TICKETRY_DATA_DIR"),
        }
    }
}

fn hanging_app_server(data_directory: &Path) -> (PathBuf, PathBuf) {
    let executable = data_directory.join("codex");
    let started = data_directory.join("app-server-started");
    fs::write(
        &executable,
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex 1.0.0\\n'; exit 0; fi\nIFS= read -r request\nprintf '%s' \"$request\" > \"${0%/*}/app-server-started\"\nwhile IFS= read -r request; do :; done\n",
    )
    .expect("write hanging app-server");
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&executable, permissions).unwrap();
    (executable, started)
}

async fn seed_safe_title(database_path: &Path) {
    let mut options = ConnectOptions::new(format!("sqlite:{}?mode=rw", database_path.display()));
    options.max_connections(1);
    let database = Database::connect(options).await.unwrap();
    database
        .execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .unwrap();
    database
        .execute_unprepared(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, provider_session_id, scope, launch_unattended) VALUES
             ('run-safe', 'scratch', 'codex', 'running', '2026-08-30T10:00:00Z', NULL, 'thread-safe', 'instant', 0);
             INSERT INTO terminal_launch_material (effect_id, agent_run_id, schema_version, request_id, issue_id, project_id, module_id, task_id, provider, scope, prompt, required_skills, working_directory_identity, initial_columns, initial_rows, created_at) VALUES
             ('effect-safe', 'run-safe', 1, 'request-safe', 'scratch', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'scratch', 'codex', 'instant', 'Context\n\nUser''s request:\n  Keep the safe title\n\nYour job:\n  hidden', '[]', '/private/repo', 80, 24, '2026-08-30T10:00:00Z');",
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn startup_applies_new_migrations_to_an_owned_installation() {
    let directory = tempfile::tempdir().unwrap();
    ticketry_installation::provision(directory.path())
        .await
        .unwrap();
    ticketry_work_management::ensure_adopted(directory.path())
        .await
        .unwrap();
    ticketry_runs::ensure_adopted(directory.path())
        .await
        .unwrap();
    ticketry_terminal::ensure_terminal_persistence_adopted(directory.path())
        .await
        .unwrap();
    ticketry_agent_execution::ensure_adopted(directory.path())
        .await
        .unwrap();
    let database_path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rw", database_path.display()))
        .await
        .unwrap();
    database
        .execute_unprepared(
            "DROP TABLE ticketry_launch_binding_profile_migration;
             ALTER TABLE worktracker_launchbinding DROP COLUMN profile;
             ALTER TABLE terminal_launch_material DROP COLUMN profile;
             DELETE FROM worktracker_agentmodel WHERE name='glm-5.3-flash';
             DROP TABLE ticketry_codex_glm_5_3_flash_catalog_migration;",
        )
        .await
        .unwrap();
    database.close().await.unwrap();

    let api = TransportApiImpl::new();
    let adopted = adopt_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        directory.path(),
        &api,
        InstallationOwnership::Owned,
    )
    .await
    .expect("reopen the prior owned schema");
    let database = adopted.runtime.commands();
    for table in ["worktracker_launchbinding", "terminal_launch_material"] {
        let columns = database
            .query_all_raw(sea_orm::Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!("PRAGMA table_info('{table}')"),
            ))
            .await
            .unwrap();
        assert!(columns
            .iter()
            .any(|row| row.try_get::<String>("", "name").as_deref() == Ok("profile")));
    }
    let model_count = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM worktracker_agentmodel WHERE name='glm-5.3-flash'"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(model_count, 1);
}

#[tokio::test]
async fn hung_codex_initialize_does_not_delay_foundation_or_replace_the_safe_title() {
    let directory = tempfile::tempdir().unwrap();
    let (executable, app_server_started) = hanging_app_server(directory.path());
    let _data_directory = DataDirectoryOverride::set(directory.path());
    approve_executable_path(SupportedTool::Codex, executable).unwrap();
    let api = TransportApiImpl::new();

    let _adopted = tokio::time::timeout(
        Duration::from_secs(4),
        adopt_worktracker_and_install(
            &directory.path().join("rust-core.sqlite3"),
            directory.path(),
            &api,
            InstallationOwnership::Owned,
        ),
    )
    .await
    .expect("foundation startup must not wait for Codex initialize")
    .expect("install foundation");

    tokio::time::timeout(Duration::from_secs(5), async {
        while !app_server_started.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background title reader must launch the approved app-server");
    assert!(
        fs::read_to_string(app_server_started)
            .unwrap()
            .contains(r#""method":"initialize""#),
        "background app-server must receive initialize"
    );
    seed_safe_title(&directory.path().join("state.db")).await;

    let request = serde_json::json!({
        "query": "query { tickets: instant_run_tickets(project_id: \"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\", module_id: \"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\") { title } providerTitle: instant_run_ticket_title(agent_run_id: \"run-safe\") }"
    });
    let encoded = tokio::time::timeout(
        Duration::from_secs(1),
        api.clone().graphql_execute(request.to_string()),
    )
    .await
    .expect("title queries must not wait for Codex initialize");
    let response: serde_json::Value = serde_json::from_str(&encoded).unwrap();

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"],
        serde_json::json!({
            "tickets": [{"title": "Keep the safe title"}],
            "providerTitle": null
        })
    );
}
