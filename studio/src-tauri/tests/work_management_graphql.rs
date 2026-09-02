use sea_orm::{ConnectionTrait, Database};
use seaography::async_graphql::{dynamic::Schema, Request, Variables};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::{foundation_schema, initialize_with_worktracker_and_install};
use ticketry_work_management::commands::CommandDatabase;

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
            id char(32) PRIMARY KEY, name varchar(255) NOT NULL,
            slug varchar(64) NOT NULL, description text NOT NULL, seq_counter integer NOT NULL,
            state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
            created_at datetime NOT NULL, updated_at datetime NOT NULL,
            onboarding_required bool NOT NULL
        );
        CREATE TABLE worktracker_issue (
            id char(32) PRIMARY KEY, project_id char(32) NOT NULL, type varchar(10) NOT NULL,
            issue_type_id char(32) NOT NULL, parent_id char(32), module_id char(32), state_id char(32),
            state_revision bigint NOT NULL, name varchar(512) NOT NULL, sequence_id integer NOT NULL,
            is_archived bool NOT NULL, rank varchar(64) NOT NULL, description text NOT NULL,
            workspace_tab_order json NOT NULL DEFAULT '[]',
            created_at datetime NOT NULL, updated_at datetime NOT NULL
        );
        CREATE TABLE worktracker_modulepresentation (
            module_id char(32) PRIMARY KEY, rank varchar(64) NOT NULL, tab_hidden bool NOT NULL
        );
        CREATE TABLE worktracker_issue_blocked_by (
            id integer PRIMARY KEY, from_issue_id char(32) NOT NULL, to_issue_id char(32) NOT NULL
        );
        CREATE TABLE worktracker_state (
            id char(32) PRIMARY KEY, project_id char(32) NOT NULL, name varchar(255) NOT NULL,
            "group" varchar(32) NOT NULL, color varchar(32) NOT NULL, sort_order integer NOT NULL,
            is_protected bool NOT NULL, created_at datetime NOT NULL, updated_at datetime NOT NULL
        );
        CREATE TABLE worktracker_issuetype (
            id char(32) PRIMARY KEY, project_id char(32) NOT NULL, name varchar(255) NOT NULL,
            level varchar(32) NOT NULL, color varchar(32) NOT NULL, sort_order integer NOT NULL,
            start_state_id char(32), workflow_revision integer NOT NULL, is_pathfind bool NOT NULL,
            created_at datetime NOT NULL, updated_at datetime NOT NULL
        );
        CREATE TABLE worktracker_issuetypetransition (
            id integer PRIMARY KEY, issue_type_id char(32) NOT NULL, from_state_id char(32) NOT NULL,
            to_state_id char(32) NOT NULL, agent_allowed bool NOT NULL
        );
        CREATE TABLE worktracker_launchbinding (
            id integer PRIMARY KEY, issue_type_id char(32) NOT NULL, state_id char(32) NOT NULL,
            prompt text NOT NULL, required_skills text NOT NULL, model_id char(32), reasoning_id char(32),
            auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
            created_at datetime NOT NULL, updated_at datetime NOT NULL
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
        CREATE TABLE graph_runs (
            root_id char(32) PRIMARY KEY, agent varchar(255), created_at datetime NOT NULL,
            updated_at datetime NOT NULL, module_id char(32), project_id char(32) NOT NULL,
            execution_mode varchar(16) NOT NULL, launch_configuration text
        );
        INSERT INTO worktracker_project VALUES
            ('10000000000000000000000000000000',
             'Memory Lane', 'MEM', '', 20, 0, 0, '2026-08-12 00:00:00', '2026-08-12 00:00:00', 0);
        INSERT INTO worktracker_issue VALUES
            ('20000000000000000000000000000001','10000000000000000000000000000000','module','30000000000000000000000000000000',NULL,NULL,NULL,0,'Older',1,0,'z','','[]','2026-08-12 00:00:01','2026-08-12 00:00:01'),
            ('20000000000000000000000000000002','10000000000000000000000000000000','module','30000000000000000000000000000000',NULL,NULL,NULL,0,'Newer',2,0,'A','','[]','2026-08-12 00:00:02','2026-08-12 00:00:02'),
            ('20000000000000000000000000000003','10000000000000000000000000000000','module','30000000000000000000000000000000',NULL,NULL,NULL,0,'Archived',3,1,'B','','[]','2026-08-12 00:00:03','2026-08-12 00:00:03'),
            ('40000000000000000000000000000001','10000000000000000000000000000000','task','30000000000000000000000000000001','20000000000000000000000000000002','20000000000000000000000000000002',NULL,4,'Root',10,0,'V','root','[]','2026-08-12 00:00:10','2026-08-12 00:00:10'),
            ('40000000000000000000000000000002','10000000000000000000000000000000','task','30000000000000000000000000000001','40000000000000000000000000000001','20000000000000000000000000000002',NULL,5,'Active child',11,0,'A','','[]','2026-08-12 00:00:11','2026-08-12 00:00:11'),
            ('40000000000000000000000000000003','10000000000000000000000000000000','task','30000000000000000000000000000001','40000000000000000000000000000001','20000000000000000000000000000002',NULL,6,'Archived child',12,1,'B','','[]','2026-08-12 00:00:12','2026-08-12 00:00:12'),
            ('40000000000000000000000000000004','10000000000000000000000000000000','task','30000000000000000000000000000001',NULL,NULL,'80000000000000000000000000000001',7,'First backlog item',13,0,'V','','[]','2026-08-12 00:00:13','2026-08-12 00:00:13'),
            ('40000000000000000000000000000005','10000000000000000000000000000000','task','30000000000000000000000000000001',NULL,NULL,'80000000000000000000000000000001',8,'Archived backlog item',14,1,'1','','[]','2026-08-12 00:00:14','2026-08-12 00:00:14'),
            ('40000000000000000000000000000006','10000000000000000000000000000000','task','30000000000000000000000000000001',NULL,NULL,'80000000000000000000000000000001',9,'Unranked backlog item',15,0,'','','[]','2026-08-12 00:00:15','2026-08-12 00:00:15'),
            ('40000000000000000000000000000007','10000000000000000000000000000000','task','30000000000000000000000000000001',NULL,NULL,'80000000000000000000000000000001',10,'Second backlog item',16,0,'k','','[]','2026-08-12 00:00:16','2026-08-12 00:00:16');
        INSERT INTO worktracker_issue_blocked_by VALUES
            (1, '40000000000000000000000000000001', '40000000000000000000000000000002');
        INSERT INTO worktracker_state VALUES
            ('80000000000000000000000000000001', '10000000000000000000000000000000',
             'Backlog', 'backlog', '#888888', 0, 1, '2026-08-12 00:00:00', '2026-08-12 00:00:00'),
            ('80000000000000000000000000000002', '10000000000000000000000000000000',
             'Ready', 'unstarted', '#777777', 1, 0, '2026-08-12 00:00:01', '2026-08-12 00:00:01');
        INSERT INTO worktracker_issuetype VALUES
            ('30000000000000000000000000000001', '10000000000000000000000000000000',
             'Task', 'task', '#888888', 0, '80000000000000000000000000000001', 1, 0,
             '2026-08-12 00:00:00', '2026-08-12 00:00:00'),
            ('30000000000000000000000000000002', '10000000000000000000000000000000',
             'Task without start', 'task', '#777777', 1, NULL, 1, 0,
             '2026-08-12 00:00:01', '2026-08-12 00:00:01');
        INSERT INTO worktracker_issuetypetransition VALUES
            (1, '30000000000000000000000000000001', '80000000000000000000000000000001',
             '80000000000000000000000000000001', 1);
        INSERT INTO worktracker_launchbinding VALUES
            (1, '30000000000000000000000000000001', '80000000000000000000000000000001',
             'Implement it.', '["tdd"]', NULL, NULL, 0, 1,
             '2026-08-12 00:00:00', '2026-08-12 00:00:00');
        INSERT INTO worktracker_provider VALUES
            ('50000000000000000000000000000000', 'codex', 1, 1);
        INSERT INTO worktracker_reasoninglevel VALUES
            ('60000000000000000000000000000000', 'high');
        INSERT INTO worktracker_agentmodel VALUES
            ('70000000000000000000000000000000', '50000000000000000000000000000000', 'gpt-5.6');
        INSERT INTO worktracker_agentmodelreasoninglevel VALUES
            (1, '70000000000000000000000000000000', '60000000000000000000000000000000');
        INSERT INTO graph_runs VALUES
            ('40000000000000000000000000000001', 'codex', '2026-08-12 00:00:01', '2026-08-12 00:00:01',
             '20000000000000000000000000000002', '10000000000000000000000000000000', 'parallel', '{"prompt":"private"}'),
            ('40000000000000000000000000000002', 'codex', '2026-08-12 00:00:02', '2026-08-12 00:00:02',
             '20000000000000000000000000000002', '10000000000000000000000000000000', 'serial', '{"prompt":"private"}'),
            ('f0000000000000000000000000000001', 'codex', '2026-08-12 00:00:03', '2026-08-12 00:00:03',
             NULL, 'f0000000000000000000000000000002', 'parallel', '{"prompt":"foreign"}');
    "#).await.expect("create Django-shaped read fixture");
    (directory, writer)
}

fn operation_request(query: &str, operation_name: &str, variables: serde_json::Value) -> String {
    serde_json::json!({
        "query": query,
        "operationName": operation_name,
        "variables": variables,
    })
    .to_string()
}

fn command_schema(database: sea_orm::DatabaseConnection) -> Schema {
    foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(CommandDatabase(database)),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("build command GraphQL schema")
}

async fn execute_schema(
    schema: &Schema,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    serde_json::to_value(
        schema
            .execute(Request::new(query).variables(Variables::from_json(variables)))
            .await,
    )
    .expect("encode GraphQL response")
}

async fn create_work_item(
    schema: &Schema,
    name: &str,
    issue_type_id: &str,
    state_id: Option<&str>,
) -> serde_json::Value {
    execute_schema(
        schema,
        r#"mutation($name: String!, $issueTypeId: String!, $stateId: String) {
            create_work_item(
                project_id: "10000000000000000000000000000000"
                name: $name
                issue_type_id: $issueTypeId
                state_id: $stateId
            ) { id name stateId rank }
        }"#,
        serde_json::json!({
            "name": name,
            "issueTypeId": issue_type_id,
            "stateId": state_id,
        }),
    )
    .await
}

#[tokio::test]
async fn create_work_item_arrives_before_the_first_active_rank_in_its_start_state() {
    let (_directory, writer) = fixture().await;
    let schema = command_schema(writer);

    let created = create_work_item(
        &schema,
        "Newest backlog item",
        "30000000000000000000000000000001",
        None,
    )
    .await;
    assert!(created.get("errors").is_none(), "{created:#}");
    assert_eq!(
        created["data"]["create_work_item"]["stateId"],
        "80000000-0000-0000-0000-000000000001"
    );
    assert_eq!(created["data"]["create_work_item"]["rank"], "F");

    let persisted = execute_schema(
        &schema,
        r#"query {
            worktrackerIssue(
                filters: {
                    projectId: { eq: "10000000000000000000000000000000" }
                    type: { eq: "task" }
                    stateId: { eq: "80000000000000000000000000000001" }
                    isArchived: { eq: false }
                    rank: { ne: "" }
                }
                orderBy: { rank: ASC, sequenceId: ASC }
            ) { nodes { name rank } }
        }"#,
        serde_json::json!({}),
    )
    .await;
    assert!(persisted.get("errors").is_none(), "{persisted:#}");
    let nodes = persisted["data"]["worktrackerIssue"]["nodes"]
        .as_array()
        .expect("persisted ranked Work Items");
    let rank = |name: &str| {
        nodes
            .iter()
            .find(|row| row["name"] == name)
            .and_then(|row| row["rank"].as_str())
            .expect("named Work Item rank")
    };
    assert_eq!(rank("First backlog item"), "V");
    assert_eq!(rank("Second backlog item"), "k");
    assert_eq!(rank("Newest backlog item"), "F");
    assert!(rank("Newest backlog item") < rank("First backlog item"));
    assert!(rank("First backlog item") < rank("Second backlog item"));
}

#[tokio::test]
async fn create_work_item_in_an_explicit_empty_state_gets_a_fractional_rank() {
    let (_directory, writer) = fixture().await;
    let schema = command_schema(writer);

    let created = create_work_item(
        &schema,
        "Ready first",
        "30000000000000000000000000000002",
        Some("80000000000000000000000000000002"),
    )
    .await;
    assert!(created.get("errors").is_none(), "{created:#}");
    assert_eq!(
        created["data"]["create_work_item"]["stateId"],
        "80000000-0000-0000-0000-000000000002"
    );
    assert_eq!(created["data"]["create_work_item"]["rank"], "V");
}

#[tokio::test]
async fn create_work_item_without_a_type_start_state_falls_back_to_backlog_first() {
    let (_directory, writer) = fixture().await;
    let schema = command_schema(writer);

    let created = create_work_item(
        &schema,
        "Fallback backlog item",
        "30000000000000000000000000000002",
        None,
    )
    .await;
    assert!(created.get("errors").is_none(), "{created:#}");
    assert_eq!(
        created["data"]["create_work_item"]["stateId"],
        "80000000-0000-0000-0000-000000000001"
    );
    assert_eq!(created["data"]["create_work_item"]["rank"], "F");
}

#[tokio::test]
async fn generated_reads_expose_filters_relations_and_dataloaders() {
    let (directory, _writer) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &api,
    )
    .await
    .expect("install composed GraphQL endpoint");

    let generated: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(request(
                r#"query($project: String!) {
          modules: worktrackerIssue(filters: { projectId: { eq: $project }, type: { eq: "module" } }) {
            nodes { name isArchived issueTypeId project { slug } }
          }
          workItems: worktrackerIssue(filters: { moduleId: { eq: "20000000000000000000000000000002" }, type: { eq: "task" } }) {
            nodes {
              name isArchived
              children(filters: { isArchived: { eq: false } }) { nodes { id } }
              blockedByEdges { nodes { toIssueId } }
              blocksEdges { nodes { fromIssueId } }
            }
          }
          agentModels: worktrackerAgentmodel {
            nodes { name providerId agentModelReasoningLevel { nodes { reasoningLevelId } } }
          }
        }"#,
                serde_json::json!({"project": "10000000000000000000000000000000"}),
            ))
            .await,
    )
    .expect("decode GraphQL read");

    assert!(generated.get("errors").is_none(), "{generated:#}");
    assert_eq!(
        generated["data"]["modules"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Older", "Newer", "Archived"]
    );
    assert_eq!(
        generated["data"]["workItems"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["Root", "Active child", "Archived child"]
    );
    assert_eq!(
        generated["data"]["workItems"]["nodes"][0]["children"]["nodes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        generated["data"]["workItems"]["nodes"][0]["blockedByEdges"]["nodes"][0]["toIssueId"],
        "40000000-0000-0000-0000-000000000002"
    );
    assert_eq!(
        generated["data"]["agentModels"]["nodes"][0]["agentModelReasoningLevel"]["nodes"][0]
            ["reasoningLevelId"],
        "60000000-0000-0000-0000-000000000000"
    );
}

#[tokio::test]
async fn graph_run_reads_are_scoped_filterable_related_and_paginated() {
    let (directory, _writer) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &api,
    )
    .await
    .expect("install composed GraphQL endpoint");

    let response: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(request(
                r#"query {
                  latest: graphRuns(
                    filters: { agent: { eq: "codex" } }
                    orderBy: { updatedAt: DESC }
                    pagination: { offset: { limit: 1, offset: 0 } }
                  ) { nodes { rootId executionMode root { name } project { slug } } }
                  serial: graphRuns(filters: { executionMode: { eq: "serial" } }) {
                    nodes { rootId executionMode module { name } }
                  }
                }"#,
                serde_json::json!({}),
            ))
            .await,
    )
    .expect("decode Graph Run read");

    assert!(response.get("errors").is_none(), "{response:#}");
    assert_eq!(
        response["data"]["latest"]["nodes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        response["data"]["latest"]["nodes"][0]["rootId"],
        "40000000-0000-0000-0000-000000000002"
    );
    assert_eq!(
        response["data"]["latest"]["nodes"][0]["root"]["name"],
        "Active child"
    );
    assert_eq!(
        response["data"]["latest"]["nodes"][0]["project"]["slug"],
        "MEM"
    );
    assert_eq!(
        response["data"]["serial"]["nodes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        response["data"]["serial"]["nodes"][0]["module"]["name"],
        "Newer"
    );
    assert!(!response.to_string().contains("private"));
    assert!(!response.to_string().contains("foreign"));
}

#[tokio::test]
async fn caller_documents_validate_and_execute_generated_reads() {
    let (directory, _writer) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &api,
    )
    .await
    .expect("install composed GraphQL endpoint");

    let introspection: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(request(
                "{ __schema { queryType { fields { name } } } }",
                serde_json::json!({}),
            ))
            .await,
    )
    .expect("decode GraphQL introspection");
    let query_fields = introspection["data"]["__schema"]["queryType"]["fields"]
        .as_array()
        .expect("query fields")
        .iter()
        .filter_map(|field| field["name"].as_str())
        .collect::<Vec<_>>();
    assert!(query_fields.contains(&"worktrackerIssue"));
    assert!(query_fields.contains(&"worktrackerProject"));
    assert!(!query_fields.contains(&"work_items"));
    assert!(!query_fields.contains(&"projects"));

    for (document, operation, variables) in [
        (
            include_str!("../../src/features/projects/operations/projects.graphql"),
            "WorkTrackerProjects",
            serde_json::json!({}),
        ),
        (
            include_str!("../../src/features/work-items/operations/workItems.graphql"),
            "WorkTrackerWorkItems",
            serde_json::json!({"projectId": "10000000000000000000000000000000"}),
        ),
        (
            include_str!("../../src/features/projects/operations/projects.graphql"),
            "WorkTrackerProjectStates",
            serde_json::json!({"projectId": "10000000000000000000000000000000"}),
        ),
    ] {
        let response: serde_json::Value = serde_json::from_str(
            &api.clone()
                .graphql_execute(operation_request(document, operation, variables))
                .await,
        )
        .expect("decode caller operation response");
        assert!(
            response.get("errors").is_none(),
            "{operation} failed: {response:#}"
        );
    }
}
