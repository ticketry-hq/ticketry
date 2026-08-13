use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_and_install;
use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::{TransportApi, TransportApiImpl};

fn request(query: &str, variables: serde_json::Value) -> String {
    serde_json::json!({ "query": query, "variables": variables }).to_string()
}

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().expect("create WorkTracker fixture directory");
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open fixture writer");
    writer.execute_unprepared(r#"
        PRAGMA journal_mode=WAL;
        CREATE TABLE worktracker_project (
            id char(32) PRIMARY KEY, workspace_id char(32) NOT NULL, name varchar(255) NOT NULL,
            slug varchar(64) NOT NULL, description text NOT NULL, seq_counter integer NOT NULL,
            state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
            created_at datetime NOT NULL, updated_at datetime NOT NULL
        );
        CREATE TABLE worktracker_issue (
            id char(32) PRIMARY KEY, project_id char(32) NOT NULL, type varchar(10) NOT NULL,
            issue_type_id char(32) NOT NULL, parent_id char(32), module_id char(32), state_id char(32),
            state_revision bigint NOT NULL, name varchar(512) NOT NULL, sequence_id integer NOT NULL,
            is_archived bool NOT NULL, rank varchar(64) NOT NULL, description text NOT NULL,
            created_at datetime NOT NULL, updated_at datetime NOT NULL
        );
        CREATE TABLE worktracker_issue_blocked_by (
            id integer PRIMARY KEY, from_issue_id char(32) NOT NULL, to_issue_id char(32) NOT NULL
        );
        CREATE TABLE worktracker_provider (
            id char(32) PRIMARY KEY, slug varchar(64) NOT NULL, activated bool NOT NULL,
            supports_unattended bool NOT NULL
        );
        CREATE TABLE worktracker_reasoninglevel (id char(32) PRIMARY KEY, name varchar(32) NOT NULL);
        CREATE TABLE worktracker_agentmodel (
            id char(32) PRIMARY KEY, provider_id char(32) NOT NULL, name varchar(255) NOT NULL
        );
        CREATE TABLE worktracker_agentmodelreasoninglevel (
            id integer PRIMARY KEY, agent_model_id char(32) NOT NULL, reasoning_level_id char(32) NOT NULL
        );
        INSERT INTO worktracker_project VALUES
            ('10000000000000000000000000000000', '90000000000000000000000000000000',
             'Memory Lane', 'MEM', '', 20, 0, 0, '2026-08-12 00:00:00', '2026-08-12 00:00:00');
        INSERT INTO worktracker_issue VALUES
            ('20000000000000000000000000000001','10000000000000000000000000000000','module','30000000000000000000000000000000',NULL,NULL,NULL,0,'Older',1,0,'z','', '2026-08-12 00:00:01','2026-08-12 00:00:01'),
            ('20000000000000000000000000000002','10000000000000000000000000000000','module','30000000000000000000000000000000',NULL,NULL,NULL,0,'Newer',2,0,'A','', '2026-08-12 00:00:02','2026-08-12 00:00:02'),
            ('20000000000000000000000000000003','10000000000000000000000000000000','module','30000000000000000000000000000000',NULL,NULL,NULL,0,'Archived',3,1,'B','', '2026-08-12 00:00:03','2026-08-12 00:00:03'),
            ('40000000000000000000000000000001','10000000000000000000000000000000','task','30000000000000000000000000000001','20000000000000000000000000000002','20000000000000000000000000000002',NULL,4,'Root',10,0,'V','root', '2026-08-12 00:00:10','2026-08-12 00:00:10'),
            ('40000000000000000000000000000002','10000000000000000000000000000000','task','30000000000000000000000000000001','40000000000000000000000000000001','20000000000000000000000000000002',NULL,5,'Active child',11,0,'A','', '2026-08-12 00:00:11','2026-08-12 00:00:11'),
            ('40000000000000000000000000000003','10000000000000000000000000000000','task','30000000000000000000000000000001','40000000000000000000000000000001','20000000000000000000000000000002',NULL,6,'Archived child',12,1,'B','', '2026-08-12 00:00:12','2026-08-12 00:00:12');
        INSERT INTO worktracker_issue_blocked_by VALUES
            (1, '40000000000000000000000000000001', '40000000000000000000000000000002');
        INSERT INTO worktracker_provider VALUES
            ('50000000000000000000000000000000', 'codex', 1, 1);
        INSERT INTO worktracker_reasoninglevel VALUES
            ('60000000000000000000000000000000', 'high');
        INSERT INTO worktracker_agentmodel VALUES
            ('70000000000000000000000000000000', '50000000000000000000000000000000', 'gpt-5.6');
        INSERT INTO worktracker_agentmodelreasoninglevel VALUES
            (1, '70000000000000000000000000000000', '60000000000000000000000000000000');
    "#).await.expect("create Django-shaped read fixture");
    (directory, writer)
}

#[tokio::test]
async fn module_and_work_item_reads_keep_drf_filters_shapes_and_ordering() {
    let (directory, writer) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &api,
    )
    .await
    .expect("install composed GraphQL endpoint");

    let automatic: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(request(
                r#"query($project: String!) {
          modules(project_id: $project) { name key is_archived issue_type }
          archived: modules(project_id: $project, include_archived: true) { name }
          work_items(module_id: "20000000-0000-0000-0000-000000000002") {
            name key is_archived sub_issues_count blocked_by_ids blocks_ids
          }
          agent_models { name provider permitted_reasoning_levels }
        }"#,
                serde_json::json!({"project": "10000000-0000-0000-0000-000000000000"}),
            ))
            .await,
    )
    .expect("decode GraphQL read");

    assert_eq!(
        automatic["data"]["modules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Newer", "Older"]
    );
    assert_eq!(
        automatic["data"]["archived"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Archived", "Newer", "Older"]
    );
    assert_eq!(
        automatic["data"]["work_items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Active child", "Archived child", "Root"]
    );
    assert_eq!(automatic["data"]["work_items"][2]["sub_issues_count"], 1);
    assert_eq!(
        automatic["data"]["work_items"][2]["blocked_by_ids"][0],
        "40000000-0000-0000-0000-000000000002"
    );
    assert_eq!(automatic["data"]["agent_models"][0]["name"], "gpt-5.6");
    assert_eq!(
        automatic["data"]["agent_models"][0]["permitted_reasoning_levels"][0],
        "60000000-0000-0000-0000-000000000000"
    );

    writer
        .execute_unprepared("UPDATE worktracker_project SET manual_module_order = 1")
        .await
        .expect("switch fixture to manual order");
    let manual: serde_json::Value = serde_json::from_str(
        &api.graphql_execute(request(
            r#"query($project: String!) { modules(project_id: $project) { name } }"#,
            serde_json::json!({"project": "10000000-0000-0000-0000-000000000000"}),
        ))
        .await,
    )
    .expect("decode manual module read");
    assert_eq!(
        manual["data"]["modules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Newer", "Older"]
    );
}
