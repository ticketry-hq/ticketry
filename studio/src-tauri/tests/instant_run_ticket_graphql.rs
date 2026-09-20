use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use futures_util::{poll, StreamExt};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use seaography::{Builder, BuilderContext};
use tauri_graphql::GraphQlEndpoint;
use ticketry_codex_app_server::{CodexAppServerError, CodexThreadTitles};

const PROJECT_ID: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MODULE_ID: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

async fn database() -> DatabaseConnection {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_unprepared(
            "CREATE TABLE agent_runs (\n\
               id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT,\n\
               model TEXT, reasoning TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL,\n\
               ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,\n\
               lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,\n\
               scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT, initial_prompt TEXT,\n\
               launch_reasoning TEXT, launch_unattended BOOL NOT NULL DEFAULT 0\n\
             );\n\
             CREATE TABLE terminal_launch_material (\n\
               effect_id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL,\n\
               request_id TEXT NOT NULL UNIQUE, issue_id TEXT NOT NULL, project_id TEXT NOT NULL,\n\
               module_id TEXT NOT NULL, task_id TEXT NOT NULL, provider TEXT, model TEXT, reasoning TEXT,\n\
               scope TEXT NOT NULL, doc_rel_path TEXT, prompt TEXT, resume_from_agent_run_id TEXT,\n\
               required_skills TEXT NOT NULL, working_directory_identity TEXT NOT NULL,\n\
               design_directory_identity TEXT, initial_columns INTEGER NOT NULL, initial_rows INTEGER NOT NULL,\n\
               created_at TEXT NOT NULL\n\
             );",
        )
        .await
        .unwrap();
    let prompt = "Private /workspace context\n\nUser's request:\n  Itemize temporary chats\n\nYour job:\n  hidden instructions";
    let sql_prompt = prompt.replace('\'', "''");
    let project = PROJECT_ID.replace('-', "");
    let module = MODULE_ID.replace('-', "");
    let foreign_module = "cccccccccccccccccccccccccccccccc";
    let insert = format!(
        "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, provider_session_id, scope) VALUES\n\
           ('run-active', 'scratch', 'codex', 'running', '2026-08-30T10:00:00Z', NULL, 'thread-active', 'instant'),\n\
           ('run-ended', 'scratch', 'codex', 'exited', '2026-08-30T09:00:00Z', '2026-08-30T09:30:00Z', 'thread-ended', 'instant'),\n\
           ('run-plan', 'scratch', 'codex', 'running', '2026-08-30T08:00:00Z', NULL, 'thread-plan', 'plan'),\n\
           ('run-task', 'task-bound', 'codex', 'running', '2026-08-30T07:30:00Z', NULL, 'thread-task', 'task'),\n\
           ('run-claude', 'scratch', 'claude', 'running', '2026-08-30T07:20:00Z', NULL, 'thread-claude', 'instant'),\n\
           ('run-no-session', 'scratch', 'codex', 'running', '2026-08-30T07:10:00Z', NULL, NULL, 'instant'),\n\
           ('run-blank-session', 'scratch', 'codex', 'running', '2026-08-30T07:05:00Z', NULL, '   ', 'instant'),\n\
           ('run-foreign', 'scratch', 'codex', 'running', '2026-08-30T07:00:00Z', NULL, 'thread-foreign', 'instant');\n\
         INSERT INTO terminal_launch_material VALUES\n\
           ('effect-active', 'run-active', 1, 'request-active', 'scratch', '{project}', '{module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T10:00:00Z'),\n\
           ('effect-ended', 'run-ended', 1, 'request-ended', 'scratch', '{project}', '{module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T09:00:00Z'),\n\
           ('effect-plan', 'run-plan', 1, 'request-plan', 'scratch', '{project}', '{module}', 'scratch', 'codex', NULL, NULL, 'plan', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T08:00:00Z'),\n\
           ('effect-task', 'run-task', 1, 'request-task', 'task-bound', '{project}', '{module}', 'task-bound', 'codex', NULL, NULL, 'task', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T07:30:00Z'),\n\
           ('effect-claude', 'run-claude', 1, 'request-claude', 'scratch', '{project}', '{foreign_module}', 'scratch', 'claude', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T07:20:00Z'),\n\
           ('effect-no-session', 'run-no-session', 1, 'request-no-session', 'scratch', '{project}', '{foreign_module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T07:10:00Z'),\n\
           ('effect-blank-session', 'run-blank-session', 1, 'request-blank-session', 'scratch', '{project}', '{foreign_module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T07:05:00Z'),\n\
           ('effect-foreign', 'run-foreign', 1, 'request-foreign', 'scratch', '{project}', '{foreign_module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T07:00:00Z');"
    );
    database.execute_unprepared(&insert).await.unwrap();
    database
}

async fn schema() -> (GraphQlEndpoint, String) {
    let database = database().await;

    let foundation = Database::connect("sqlite::memory:").await.unwrap();
    let schema = ticketry_graphql_schema::foundation_schema(
        foundation,
        Some(database),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let sdl = schema.sdl();
    (GraphQlEndpoint::new(schema), sdl)
}

#[derive(Clone)]
struct ScriptedTitleReader {
    title: Option<String>,
    calls: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl CodexThreadTitles for ScriptedTitleReader {
    async fn read_thread_title(
        &self,
        thread_id: &str,
    ) -> Result<Option<String>, CodexAppServerError> {
        self.calls.lock().unwrap().push(thread_id.to_owned());
        Ok(self.title.clone())
    }
}

#[derive(Clone)]
struct UnavailableTitleReader(&'static str);

#[async_trait]
impl CodexThreadTitles for UnavailableTitleReader {
    async fn read_thread_title(
        &self,
        _thread_id: &str,
    ) -> Result<Option<String>, CodexAppServerError> {
        Err(CodexAppServerError::unavailable(self.0))
    }
}

async fn title_schema(reader: ScriptedTitleReader) -> GraphQlEndpoint {
    title_schema_with_database(database().await, reader).await.0
}

async fn title_schema_with_database(
    database: DatabaseConnection,
    reader: ScriptedTitleReader,
) -> (GraphQlEndpoint, String) {
    let context = Box::leak(Box::new(BuilderContext::default()));
    let builder = ticketry_terminal::register_instant_run_ticket_graphql(Builder::new(
        context,
        database.clone(),
    ));
    let schema = builder
        .schema_builder()
        .data(database.clone())
        .data(ticketry_terminal::InstantRunTicketTitleService::new(
            database,
            Arc::new(reader),
        ))
        .finish()
        .expect("build Instant ticket title schema");
    let sdl = schema.sdl();
    (GraphQlEndpoint::new(schema), sdl)
}

async fn execute_title(endpoint: &GraphQlEndpoint, agent_run_id: &str) -> serde_json::Value {
    let request = serde_json::json!({
        "query": "query Title($agentRunId: String!) { title: instant_run_ticket_title(agent_run_id: $agentRunId) }",
        "variables": { "agentRunId": agent_run_id }
    });
    serde_json::from_str(&endpoint.execute_json(&request.to_string()).await).unwrap()
}

#[cfg(unix)]
struct RecoveringAppServer {
    _directory: tempfile::TempDir,
    executable: PathBuf,
}

#[cfg(unix)]
impl RecoveringAppServer {
    fn new(title: &str) -> Self {
        let directory = tempfile::tempdir().expect("create recovery app-server directory");
        let executable = directory.path().join("codex");
        let launches = directory.path().join("launches");
        let script = format!(
            "#!/bin/sh\nlaunches='{}'\ntitle='{}'\nif [ -f \"$launches\" ]; then launch=$(wc -l < \"$launches\"); else launch=0; fi\nlaunch=$((launch + 1))\nprintf '%s\\n' launched >> \"$launches\"\nwhile IFS= read -r request; do\n  request_id=$(printf '%s\\n' \"$request\" | sed -n 's/.*\"id\":\\([0-9][0-9]*\\).*/\\1/p')\n  case \"$request\" in\n    *'\"method\":\"initialize\"'*) printf '{{\"id\":%s,\"result\":{{}}}}\\n' \"$request_id\" ;;\n    *'\"method\":\"thread/read\"'*) if [ \"$launch\" -eq 1 ]; then exit 0; fi; printf '{{\"id\":%s,\"result\":{{\"thread\":{{\"name\":%s}}}}}}\\n' \"$request_id\" \"$title\" ;;\n  esac\ndone\n",
            shell_literal(&launches),
            serde_json::to_string(title).expect("serialize recovery title")
        );
        fs::write(&executable, script).expect("write recovery app-server");
        let mut permissions = fs::metadata(&executable)
            .expect("read recovery app-server metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&executable, permissions).expect("make recovery app-server executable");
        Self {
            _directory: directory,
            executable,
        }
    }
}

#[cfg(unix)]
fn shell_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "'\"'\"'")
}

#[tokio::test]
async fn active_instant_runs_are_projected_as_titled_tickets() {
    let (endpoint, _) = schema().await;
    let request = serde_json::json!({
        "query": "query Tickets($project: String!, $module: String!) { tickets: instant_run_tickets(project_id: $project, module_id: $module) { agent_run_id title started_at } }",
        "variables": { "project": PROJECT_ID, "module": MODULE_ID }
    });
    let response: serde_json::Value =
        serde_json::from_str(&endpoint.execute_json(&request.to_string()).await).unwrap();

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"]["tickets"],
        serde_json::json!([{
            "agent_run_id": "run-active",
            "title": "Itemize temporary chats",
            "started_at": "2026-08-30T10:00:00Z"
        }])
    );
}

#[tokio::test]
async fn accepted_codex_thread_name_is_returned_for_eligible_agent_run() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let endpoint = title_schema(ScriptedTitleReader {
        title: Some("Rename the selected conversation".to_owned()),
        calls: calls.clone(),
    })
    .await;
    let response = execute_title(&endpoint, "run-active").await;

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"],
        serde_json::json!({"title": "Rename the selected conversation"})
    );
    assert_eq!(*calls.lock().unwrap(), ["thread-active"]);
}

#[tokio::test]
async fn a_prompt_prefix_is_rejected_after_whitespace_normalization() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let endpoint = title_schema(ScriptedTitleReader {
        title: Some("Private /workspace\n\tcontext".to_owned()),
        calls: calls.clone(),
    })
    .await;

    let response = execute_title(&endpoint, "run-active").await;

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(response["data"], serde_json::json!({"title": null}));
    assert_eq!(*calls.lock().unwrap(), ["thread-active"]);
}

#[tokio::test]
async fn null_and_blank_thread_names_leave_the_safe_title_unchanged() {
    for title in [None, Some(" \n\t ".to_owned())] {
        let endpoint = title_schema(ScriptedTitleReader {
            title,
            calls: Arc::new(Mutex::new(Vec::new())),
        })
        .await;

        let response = execute_title(&endpoint, "run-active").await;

        assert_eq!(response["errors"], serde_json::Value::Null);
        assert_eq!(response["data"], serde_json::json!({"title": null}));
    }
}

#[tokio::test]
async fn ineligible_agent_runs_do_not_reach_the_codex_reader() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let endpoint = title_schema(ScriptedTitleReader {
        title: Some("Must not be returned".to_owned()),
        calls: calls.clone(),
    })
    .await;

    for agent_run_id in [
        "run-ended",
        "run-plan",
        "run-task",
        "run-claude",
        "run-no-session",
        "run-blank-session",
        "run-unknown",
    ] {
        let response = execute_title(&endpoint, agent_run_id).await;
        assert_eq!(response["errors"], serde_json::Value::Null);
        assert_eq!(response["data"], serde_json::json!({"title": null}));
    }
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_codex_reads_leave_the_safe_title_unchanged() {
    for failure in [
        "thread not loaded",
        "timed out",
        "malformed reply",
        "unavailable child",
        "restarting child",
    ] {
        let database = database().await;
        let context = Box::leak(Box::new(BuilderContext::default()));
        let builder = ticketry_terminal::register_instant_run_ticket_graphql(Builder::new(
            context,
            database.clone(),
        ));
        let schema = builder
            .schema_builder()
            .data(ticketry_terminal::InstantRunTicketTitleService::new(
                database,
                Arc::new(UnavailableTitleReader(failure)),
            ))
            .finish()
            .unwrap();
        let response = execute_title(&GraphQlEndpoint::new(schema), "run-active").await;

        assert_eq!(response["errors"], serde_json::Value::Null);
        assert_eq!(response["data"], serde_json::json!({"title": null}));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_restarted_title_reader_notifies_graphql_then_returns_the_recovered_title() {
    let server = RecoveringAppServer::new("Recovered conversation title");
    let database = database().await;
    let service = ticketry_terminal::InstantRunTicketTitleService::start(
        database.clone(),
        &server.executable,
    )
    .await
    .expect("start title service");
    let context = Box::leak(Box::new(BuilderContext::default()));
    let builder = ticketry_terminal::register_instant_run_ticket_graphql(Builder::new(
        context,
        database.clone(),
    ));
    let schema = builder
        .schema_builder()
        .data(database)
        .data(service)
        .finish()
        .expect("build recovery schema");
    let endpoint = GraphQlEndpoint::new(schema);
    let request = serde_json::json!({
        "query": "subscription Recovery { restarted: instant_run_ticket_title_restarted }"
    });
    let stream = endpoint
        .execute_stream_json(&request.to_string())
        .expect("open title recovery subscription");
    futures_util::pin_mut!(stream);
    assert!(poll!(stream.next()).is_pending());

    let unavailable = execute_title(&endpoint, "run-active").await;
    assert_eq!(unavailable["errors"], serde_json::Value::Null);
    assert_eq!(unavailable["data"], serde_json::json!({"title": null}));

    let event = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .expect("receive the recovery event")
        .expect("recovery subscription stays open");
    let event: serde_json::Value = serde_json::from_str(&event).expect("decode recovery event");
    assert_eq!(event["errors"], serde_json::Value::Null);
    assert_eq!(event["data"], serde_json::json!({"restarted": true}));

    let response = execute_title(&endpoint, "run-active").await;
    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"],
        serde_json::json!({"title": "Recovered conversation title"})
    );
}

#[tokio::test]
async fn thread_title_query_never_exposes_launch_material() {
    let database = database().await;
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (endpoint, sdl) = title_schema_with_database(
        database,
        ScriptedTitleReader {
            title: Some("A provider-owned name".to_owned()),
            calls,
        },
    )
    .await;

    let response = execute_title(&endpoint, "run-active").await;

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"],
        serde_json::json!({"title": "A provider-owned name"})
    );
    assert!(!sdl.contains("terminalLaunchMaterial"));
    assert!(!sdl.contains("prompt"));
}

#[tokio::test]
async fn thread_title_query_reads_one_run_with_private_material_and_one_codex_thread() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let endpoint = title_schema(ScriptedTitleReader {
        title: Some("Bounded read".to_owned()),
        calls: calls.clone(),
    })
    .await;

    let response = execute_title(&endpoint, "run-active").await;

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"],
        serde_json::json!({"title": "Bounded read"})
    );
    assert_eq!(*calls.lock().unwrap(), ["thread-active"]);
}

#[tokio::test]
async fn launch_material_stays_out_of_the_public_contract() {
    let (_, sdl) = schema().await;

    assert!(sdl.contains("instant_run_tickets"));
    assert!(sdl.contains("instant_run_ticket_title(agent_run_id: String!): String"));
    assert!(sdl.contains("type InstantRunTicket"));
    assert!(!sdl.contains("terminalLaunchMaterial"));
    let ticket_output = sdl
        .split_once("type InstantRunTicket {")
        .and_then(|(_, tail)| tail.split_once('}').map(|(block, _)| block))
        .expect("InstantRunTicket SDL block");
    assert!(!ticket_output.contains("prompt"));
    assert!(!ticket_output.contains("working_directory"));
    assert!(!ticket_output.contains("design_directory"));
    assert!(!ticket_output.contains("required_skills"));
}

#[tokio::test]
async fn instant_ticket_projection_is_bounded() {
    assert_eq!(ticketry_terminal::INSTANT_RUN_TICKET_LIMIT, 100);
}
