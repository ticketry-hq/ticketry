//! Fixtures and public GraphQL observations shared by sprint socket cases.

use std::sync::Arc;

use sea_orm::{ConnectionTrait, Database};
use seaography::async_graphql::dynamic::Schema;
use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{
    allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient, PROJECT,
};

use super::super::{prepare_command_database, MissingTerminalRuntime, MODULE};

pub(super) const ACTIVE: &str = "81000000-0000-0000-0000-000000000001";
pub(super) const PLANNED: &str = "81000000-0000-0000-0000-000000000002";
pub(super) const COMPLETED: &str = "81000000-0000-0000-0000-000000000003";
pub(super) const FOREIGN: &str = "81000000-0000-0000-0000-000000000004";
pub(super) const UNKNOWN: &str = "81000000-0000-0000-0000-000000000099";
pub(super) const LATER: &str = "81000000-0000-0000-0000-000000000005";
pub(super) const FOREIGN_PROJECT: &str = "91000000-0000-0000-0000-000000000000";

pub(super) struct Fixture {
    pub client: SocketClient,
    pub runtime: McpRuntime,
    pub schema: Schema,
    _ownership: DataDirectoryGuard,
    _directory: tempfile::TempDir,
}

impl Fixture {
    pub async fn new(active: bool) -> Self {
        Self::with_open_sprints(active, true).await
    }

    pub async fn without_planned(active: bool) -> Self {
        Self::with_open_sprints(active, false).await
    }

    async fn with_open_sprints(active: bool, planned: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        prepare_command_database(&directory).await;
        let database = Database::connect(format!(
            "sqlite:{}",
            directory.path().join("state.db").display()
        ))
        .await
        .unwrap();
        ticketry_work_management::install_sprint_rank_schema(&database)
            .await
            .unwrap();
        database.execute_unprepared(r#"
            INSERT INTO worktracker_project
                (id, name, slug, description, seq_counter, state_revision,
                 created_at, updated_at, onboarding_required) VALUES
                ('91000000000000000000000000000000', 'Foreign', 'FOREIGN', '', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_sprint (id, project_id, name, status, rank, created_at, updated_at) VALUES
                ('81000000000000000000000000000001', '10000000000000000000000000000000',
                 'Current sprint', 'active', 'A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('81000000000000000000000000000002', '10000000000000000000000000000000',
                 'Planned sprint', 'planned', 'B', '2026-10-09 00:00:00', CURRENT_TIMESTAMP),
                ('81000000000000000000000000000003', '10000000000000000000000000000000',
                 'Completed sprint', 'completed', '1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('81000000000000000000000000000004', '91000000000000000000000000000000',
                 'Foreign sprint', 'active', 'A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('81000000000000000000000000000005', '10000000000000000000000000000000',
                 'Later sprint', 'planned', 'C', '2026-10-01 00:00:00', CURRENT_TIMESTAMP);
        "#).await.unwrap();
        if !active {
            database.execute_unprepared("UPDATE worktracker_sprint SET status = 'completed' WHERE id = '81000000000000000000000000000001'")
                .await.unwrap();
        }
        if !planned {
            database
                .execute_unprepared("DELETE FROM worktracker_sprint WHERE status = 'planned'")
                .await
                .unwrap();
        }
        let schema = ticketry_graphql_schema::foundation_schema(
            database.clone(),
            Some(database.clone()),
            Some(ticketry_work_management::CommandDatabase(database)),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
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
        Self {
            client,
            runtime,
            schema,
            _ownership: ownership,
            _directory: directory,
        }
    }

    pub async fn snapshot(&self) -> Value {
        let response = self
            .schema
            .execute(format!(
                r#"query {{
            worktrackerIssue(filters: {{ projectId: {{ eq: "{}" }} }}) {{
                nodes {{ id name description parentId sprintId stateRevision }}
            }}
            worktrackerProject(filters: {{ id: {{ eq: "{}" }} }}) {{
                nodes {{ stateRevision seqCounter }}
            }}
        }}"#,
                PROJECT.replace('-', ""),
                PROJECT.replace('-', "")
            ))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let mut value = response.data.into_json().unwrap();
        value["worktrackerIssue"]["nodes"]
            .as_array_mut()
            .unwrap()
            .sort_by_key(|row| row["id"].as_str().unwrap().to_owned());
        value
    }

    pub async fn task(&self, id: &str) -> Value {
        self.snapshot().await["worktrackerIssue"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"].as_str().unwrap().replace('-', "") == id.replace('-', ""))
            .unwrap_or_else(|| panic!("missing ticket {id}"))
            .clone()
    }
}

pub(super) fn create_arguments(name: &str) -> Value {
    json!({"project_id": PROJECT, "module_id": MODULE, "name": name, "issue_type": "Story"})
}

pub(super) fn assert_sprint(result: &Value, id: &str, name: &str, status: &str) {
    assert_eq!(result["ok"], true, "{result:#}");
    assert_eq!(
        result["sprint"],
        json!({"id": id, "name": name, "status": status}),
        "{result:#}"
    );
}

pub(super) fn task_id(result: &Value) -> String {
    result["task_id"]
        .as_str()
        .or_else(|| result["result"].as_str())
        .unwrap_or_else(|| panic!("create failed: {result:#}"))
        .to_owned()
}
