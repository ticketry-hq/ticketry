use std::path::{Path, PathBuf};

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::initialize_with_worktracker_commands_and_install;

use super::git_fixture::{GitFixture, RepositorySnapshot, Scenario, BRANCH};

const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const DONE: &str = "40000000000000000000000000000002";
const MODULE: &str = "20000000000000000000000000000001";
const WORK_ITEM: &str = "60000000000000000000000000000001";

const COMPLETE: &str = r#"mutation($id: String!, $stateId: String!) {
  update_work_item(id: $id, state_id: $stateId) { id stateId }
}"#;

const STATUS: &str = r#"query($taskId: String!) {
  worktree_status(task_id: $taskId) {
    kind task_id branch base_branch path state clean dirty ahead behind
    conflict checkout_present ephemeral reason
  }
}"#;

const DISCARD: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_discard(task_id: $taskId, operation_id: $operationId) {
    removed task_id branch reason
    status { kind branch path checkout_present }
  }
}"#;

#[derive(Debug, Eq, PartialEq)]
struct WorktreeRow {
    id: String,
    task_id: String,
    workspace_slug: Option<String>,
    project_id: Option<String>,
    module_id: Option<String>,
    ticket_seq: Option<i32>,
    repo_root: String,
    path: String,
    branch: String,
    base_branch: String,
    base_commit: String,
    status: String,
    ephemeral: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Eq, PartialEq)]
struct CompletionSnapshot {
    repository: RepositorySnapshot,
    row: Option<WorktreeRow>,
    public_status: serde_json::Value,
}

pub struct Fixture {
    directory: tempfile::TempDir,
    git: GitFixture,
    api: Option<TransportApiImpl>,
}

impl Fixture {
    fn state(&self) -> PathBuf {
        self.directory.path().join("state.db")
    }

    fn api(&self) -> &TransportApiImpl {
        self.api.as_ref().expect("installed GraphQL backend")
    }

    pub async fn complete(&self) {
        let response = execute(
            self.api(),
            COMPLETE,
            serde_json::json!({"id": WORK_ITEM, "stateId": DONE}),
        )
        .await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
        assert_eq!(
            response["data"]["update_work_item"]["stateId"],
            uuid::Uuid::parse_str(DONE)
                .expect("valid Done state identity")
                .to_string()
        );
    }

    pub async fn set_transition_agent_allowed(&self, allowed: bool) {
        let database = Database::connect(format!("sqlite:{}?mode=rw", self.state().display()))
            .await
            .expect("open fixture workflow store");
        database
            .execute_unprepared(&format!(
                "UPDATE worktracker_issuetypetransition SET agent_allowed = {}",
                i32::from(allowed)
            ))
            .await
            .expect("set fixture transition permission");
    }

    pub async fn restart(&mut self) {
        drop(self.api.take());
        self.api = Some(install(self.directory.path()).await);
    }

    pub async fn status(&self) -> serde_json::Value {
        let response = execute(self.api(), STATUS, serde_json::json!({"taskId": WORK_ITEM})).await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
        response["data"]["worktree_status"].clone()
    }

    async fn snapshot(&self) -> CompletionSnapshot {
        let public_status = self.status().await;
        CompletionSnapshot {
            repository: self.git.snapshot(),
            row: worktree_row(&self.state()).await,
            public_status,
        }
    }

    pub async fn discard(&self) -> serde_json::Value {
        let response = execute(
            self.api(),
            DISCARD,
            serde_json::json!({
                "taskId": WORK_ITEM,
                "operationId": uuid::Uuid::new_v4().to_string(),
            }),
        )
        .await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
        response["data"]["worktree_discard"].clone()
    }

    pub fn checkout_path(&self) -> &Path {
        self.git.checkout()
    }

    pub fn repository_path(&self) -> &Path {
        self.git.repository()
    }

    pub async fn graphql(&self, query: &str, variables: serde_json::Value) -> serde_json::Value {
        execute(self.api(), query, variables).await
    }

    pub fn checkout_is_openable(&self) -> bool {
        self.git.checkout_is_openable()
    }

    pub fn read_checkout(&self, relative_path: &str) -> String {
        self.git.read_checkout(relative_path)
    }

    pub async fn row_exists(&self) -> bool {
        worktree_row(&self.state()).await.is_some()
    }

    pub fn branch_exists(&self) -> bool {
        self.git.branch_exists()
    }
}

pub async fn assert_completion_preserves(scenario: Scenario) {
    let mut fixture = fixture(scenario).await;
    let before = fixture.snapshot().await;
    match scenario {
        Scenario::Clean => {
            assert_eq!(before.public_status["clean"], true);
            assert_eq!(before.public_status["ahead"], 0);
            assert_eq!(before.public_status["behind"], 0);
        }
        Scenario::Dirty => {
            assert_eq!(before.public_status["dirty"], true);
            assert_eq!(before.public_status["clean"], false);
        }
        Scenario::Diverged => {
            assert_eq!(before.public_status["clean"], true);
            assert_eq!(before.public_status["ahead"], 1);
            assert_eq!(before.public_status["behind"], 1);
        }
        Scenario::Conflict => {
            assert_eq!(before.public_status["conflict"], true);
            assert_eq!(before.public_status["clean"], false);
        }
    }
    fixture.complete().await;
    fixture.restart().await;
    let after = fixture.snapshot().await;
    assert_eq!(
        after, before,
        "Work Item completion and backend restart mutated its worktree"
    );
}

pub async fn fixture(scenario: Scenario) -> Fixture {
    let directory = tempfile::tempdir().expect("create completion fixture directory");
    let git = GitFixture::new(directory.path(), scenario);

    let state = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", state.display()))
        .await
        .expect("open fixture writer");
    writer
        .execute_unprepared(&fixture_schema(
            git.repository(),
            git.checkout(),
            git.base_commit(),
        ))
        .await
        .expect("create completion fixture schema");
    ticketry_work_management::schema::install(&writer)
        .await
        .expect("install Module Link schema");
    ticketry_work_management::ModuleLinkStore::new(writer.clone())
        .set(MODULE, &git.repository().display().to_string())
        .await
        .expect("link module to repository");
    drop(writer);

    let api = install(directory.path()).await;
    Fixture {
        directory,
        git,
        api: Some(api),
    }
}

fn fixture_schema(repository: &Path, checkout: &Path, base_commit: &str) -> String {
    let replacements = [
        ("$MODULE_TYPE", MODULE_TYPE),
        ("$TASK_TYPE", TASK_TYPE),
        ("$BASE_COMMIT", base_commit),
        ("$REPOSITORY", &repository.display().to_string()),
        ("$WORK_ITEM", WORK_ITEM),
        ("$CHECKOUT", &checkout.display().to_string()),
        ("$PROJECT", PROJECT),
        ("$BACKLOG", BACKLOG),
        ("$MODULE", MODULE),
        ("$BRANCH", BRANCH),
        ("$DONE", DONE),
    ];
    replacements.into_iter().fold(
        include_str!("worktree_completion_schema.sql").to_owned(),
        |schema, (placeholder, value)| schema.replace(placeholder, value),
    )
}

async fn install(directory: &Path) -> TransportApiImpl {
    let api = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &directory.join("rust-core.sqlite3"),
        &directory.join("state.db"),
        &directory.join("media"),
        &api,
    )
    .await
    .expect("compose the GraphQL backend");
    api
}

async fn execute(
    api: &TransportApiImpl,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    let response = api
        .clone()
        .graphql_execute(serde_json::json!({"query": query, "variables": variables}).to_string())
        .await;
    serde_json::from_str(&response).expect("decode GraphQL response")
}

async fn worktree_row(state: &Path) -> Option<WorktreeRow> {
    let database = Database::connect(format!("sqlite:{}?mode=rw", state.display()))
        .await
        .expect("open durable state");
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT id, task_id, workspace_slug, project_id, module_id, ticket_seq, \
                 repo_root, path, branch, base_branch, base_commit, status, ephemeral, \
                 created_at, updated_at FROM worktrees WHERE task_id = '{WORK_ITEM}'"
            ),
        ))
        .await
        .expect("read durable worktree row")?;
    Some(WorktreeRow {
        id: row.try_get_by_index(0).expect("id"),
        task_id: row.try_get_by_index(1).expect("task id"),
        workspace_slug: row.try_get_by_index(2).expect("workspace slug"),
        project_id: row.try_get_by_index(3).expect("project id"),
        module_id: row.try_get_by_index(4).expect("module id"),
        ticket_seq: row.try_get_by_index(5).expect("ticket sequence"),
        repo_root: row.try_get_by_index(6).expect("repository root"),
        path: row.try_get_by_index(7).expect("path"),
        branch: row.try_get_by_index(8).expect("branch"),
        base_branch: row.try_get_by_index(9).expect("base branch"),
        base_commit: row.try_get_by_index(10).expect("base commit"),
        status: row.try_get_by_index(11).expect("status"),
        ephemeral: row.try_get_by_index(12).expect("ephemeral"),
        created_at: row.try_get_by_index(13).expect("created at"),
        updated_at: row.try_get_by_index(14).expect("updated at"),
    })
}
