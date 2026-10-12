//! CODING-2863: sprint discovery exists only where the edition grants sprint
//! planning. Pocock keeps the `agent_execution_*` registration (the SDL is
//! identical in both editions) but refuses it with a typed edition error, and
//! never recovers or otherwise touches persisted sprint-discovery rows.

use sea_orm::{ConnectionTrait, DatabaseConnection};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_edition::{has, EditionCapability};
use ticketry_graphql_schema::{adopt_worktracker_and_install, InstallationOwnership};

const PROJECT: &str = "20000000000000000000000000000001";
const ISSUE_TYPE: &str = "70000000000000000000000000000001";
const MODULE: &str = "50000000000000000000000000000002";
const SPRINT: &str = "10000000000000000000000000000001";
const RUN: &str = "60000000000000000000000000000001";
const EXECUTION: &str = "80000000000000000000000000000001";

const CREATE: &str = "mutation($p:String!,$s:String!,$r:String!){agent_execution_create(project_id:$p,sprint_id:$s,client_request_id:$r){id state}}";
const CANCEL: &str = "mutation($p:String!,$id:String!){agent_execution_update(project_id:$p,id:$id,cancel_requested:true){id state}}";

async fn adopt(directory: &std::path::Path) -> (TransportApiImpl, DatabaseConnection) {
    let api = TransportApiImpl::new();
    let adopted = adopt_worktracker_and_install(
        &directory.join("rust-core.sqlite3"),
        directory,
        &api,
        InstallationOwnership::Owned,
    )
    .await
    .expect("adopt the installation");
    let database = adopted.runtime.commands().clone();
    drop(adopted);
    // Open the command gate the way the development adapter does once its
    // runtimes are up.
    ticketry_settings::publish_readiness(directory, &ticketry_settings::Slice2Readiness::complete())
        .unwrap();
    ticketry_runs::publish_readiness(directory, &ticketry_runs::Slice3Readiness::complete())
        .unwrap();
    ticketry_workspace_runtime::publish_readiness(
        directory,
        &ticketry_workspace_runtime::Slice4Readiness::complete(),
    )
    .unwrap();
    (api, database)
}

async fn seed_execution(database: &DatabaseConnection, state: &str) {
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_project
               (id,name,slug,description,seq_counter,state_revision,created_at,updated_at,onboarding_required)
               VALUES ('{PROJECT}','Project','project','',2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0);
             INSERT INTO worktracker_issuetype
               (id,project_id,name,level,color,sort_order,start_state_id,workflow_revision,is_pathfind,created_at,updated_at)
               VALUES ('{ISSUE_TYPE}','{PROJECT}','Epic','module','',1,NULL,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT INTO worktracker_issue
               (id,project_id,type,issue_type_id,state_revision,name,sequence_id,is_archived,rank,description,workspace_tab_order,created_at,updated_at)
               VALUES ('{MODULE}','{PROJECT}','module','{ISSUE_TYPE}',1,'Epic',1,0,'','','[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT INTO worktracker_sprint (id,project_id,name,status,rank,created_at,updated_at)
               VALUES ('{SPRINT}','{PROJECT}','Sprint','planned','V',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
             INSERT INTO agent_runs (id,issue_id,status,started_at,scope,launch_unattended)
               VALUES ('{RUN}','{MODULE}','running','2026-01-01T00:00:00Z','exec',0);
             INSERT INTO agent_executions
               (id,client_request_id,agent_run_id,sprint_id,output_type,input_snapshot,goals_revision,state,error,cancel_requested,created_at,updated_at)
               VALUES ('{EXECUTION}','request-1','{RUN}','{SPRINT}','sprint_suggestions_v1','{{}}',NULL,'{state}',NULL,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);"
        ))
        .await
        .expect("seed a sprint-discovery execution");
}

async fn execution_state(database: &DatabaseConnection) -> (String, String) {
    let row = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            format!(
                "SELECT e.state AS execution, r.status AS run FROM agent_executions e
                 JOIN agent_runs r ON r.id = e.agent_run_id WHERE e.id = '{EXECUTION}'"
            ),
        ))
        .await
        .unwrap()
        .expect("seeded execution");
    (
        row.try_get::<String>("", "execution").unwrap(),
        row.try_get::<String>("", "run").unwrap(),
    )
}

async fn execute(
    api: &TransportApiImpl,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    let response = api
        .clone()
        .graphql_execute(serde_json::json!({ "query": query, "variables": variables }).to_string())
        .await;
    serde_json::from_str(&response).expect("decode GraphQL response")
}

fn assert_edition_refusal(response: &serde_json::Value) {
    assert_eq!(response["data"], serde_json::Value::Null, "{response}");
    let error = &response["errors"][0];
    assert_eq!(
        error["extensions"]["code"], "edition_capability_unavailable",
        "{response}"
    );
    assert_eq!(
        error["message"], "Sprint discovery is not available in the pocock edition.",
        "{response}"
    );
}

#[tokio::test]
async fn startup_recovers_interrupted_discovery_only_where_sprint_planning_is_granted() {
    let directory = tempfile::tempdir().unwrap();
    let (_api, database) = adopt(directory.path()).await;
    seed_execution(&database, "running").await;
    database.close().await.unwrap();

    // A restart composes the runtime again over the interrupted execution.
    let (_api, database) = adopt(directory.path()).await;
    let (execution, run) = execution_state(&database).await;
    if has(EditionCapability::SprintPlanning) {
        assert_eq!((execution.as_str(), run.as_str()), ("failed", "failed"));
    } else {
        assert_eq!((execution.as_str(), run.as_str()), ("running", "running"));
    }
}

#[tokio::test]
async fn public_graphql_refuses_sprint_discovery_outside_sprint_planning_editions() {
    let directory = tempfile::tempdir().unwrap();
    let (api, database) = adopt(directory.path()).await;
    seed_execution(&database, "queued").await;

    let cancel = execute(&api, CANCEL, serde_json::json!({ "p": PROJECT, "id": EXECUTION })).await;
    if has(EditionCapability::SprintPlanning) {
        assert_eq!(cancel["errors"], serde_json::Value::Null, "{cancel}");
        assert_eq!(cancel["data"]["agent_execution_update"]["state"], "cancelled");
        return;
    }
    assert_edition_refusal(&cancel);

    let create = execute(
        &api,
        CREATE,
        serde_json::json!({ "p": PROJECT, "s": SPRINT, "r": "request-2" }),
    )
    .await;
    assert_edition_refusal(&create);

    let (execution, run) = execution_state(&database).await;
    assert_eq!((execution.as_str(), run.as_str()), ("queued", "running"));
    let created = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM agent_executions".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(created, 1, "Pocock must not create a discovery execution");
}
