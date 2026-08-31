use sea_orm::{ActiveModelTrait, ActiveValue::Set, ConnectionTrait, Database, EntityTrait};

use ticketry_entities::work_management::{issue, module_presentation as presentation};
use ticketry_work_management::work_management::commands::{reorder, work_items};
use ticketry_work_management::work_management::{open_for_commands, read_queries};

const PROJECT: &str = "10000000000000000000000000000000";
const MODULE_TYPE: &str = "20000000000000000000000000000000";
const A: &str = "30000000000000000000000000000001";
const B: &str = "30000000000000000000000000000002";
const C: &str = "30000000000000000000000000000003";
const ARCHIVED: &str = "30000000000000000000000000000004";

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY, name text NOT NULL, slug text NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL, onboarding_required bool NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name text NOT NULL, level text NOT NULL, color text NOT NULL,
                sort_order integer NOT NULL, start_state_id char(32),
                workflow_revision integer NOT NULL, is_pathfind bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issue (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type text NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name text NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank text NOT NULL, description text NOT NULL,
                workspace_tab_order text NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(project_id, sequence_id)
            );
            CREATE TABLE worktracker_modulepresentation (
                module_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id) ON DELETE CASCADE,
                rank text NOT NULL DEFAULT '', tab_hidden bool NOT NULL DEFAULT 0
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Project', 'PRJ', '', 4, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_issuetype VALUES
                ('{MODULE_TYPE}', '{PROJECT}', 'Module', 'module', '', 0, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#,
        ))
        .await
        .unwrap();
    for (id, name, sequence, archived) in [
        (A, "a", 1, false),
        (B, "b", 2, false),
        (C, "c", 3, false),
        (ARCHIVED, "archived", 4, true),
    ] {
        issue::ActiveModel {
            id: Set(id.to_owned()),
            project_id: Set(PROJECT.to_owned()),
            r#type: Set("module".to_owned()),
            issue_type_id: Set(MODULE_TYPE.to_owned()),
            parent_id: Set(None),
            module_id: Set(None),
            state_id: Set(None),
            state_revision: Set(0),
            name: Set(name.to_owned()),
            sequence_id: Set(sequence),
            is_archived: Set(archived),
            rank: Set(format!("legacy-{sequence}")),
            description: Set(String::new()),
            workspace_tab_order: Set(serde_json::json!([])),
            created_at: Set(chrono::Utc::now().naive_utc()),
            updated_at: Set(chrono::Utc::now().naive_utc()),
        }
        .insert(&writer)
        .await
        .unwrap();
    }
    drop(writer);
    let database = open_for_commands(&path).await.unwrap();
    (directory, database)
}

fn move_module(
    id: &str,
    before: Option<&str>,
    after: Option<&str>,
    baseline: Option<Vec<&str>>,
) -> reorder::ReorderWorkItem {
    reorder::ReorderWorkItem {
        id: id.to_owned(),
        before_id: before.map(str::to_owned),
        after_id: after.map(str::to_owned),
        initial_order_ids: baseline.map(|ids| ids.into_iter().map(str::to_owned).collect()),
    }
}

async fn active_order(database: &sea_orm::DatabaseConnection) -> Vec<String> {
    read_queries::modules(database, PROJECT, false)
        .await
        .unwrap()
        .into_iter()
        .map(|module| module.name)
        .collect()
}

async fn presentations(database: &sea_orm::DatabaseConnection) -> Vec<presentation::Model> {
    presentation::Entity::find().all(database).await.unwrap()
}

async fn update_visibility(
    database: &sea_orm::DatabaseConnection,
    module_id: &str,
    tab_hidden: bool,
) -> presentation::Model {
    let schema = muxed_studio_lib::query_root::generated_contract_schema(database.clone()).unwrap();
    let response = schema
        .execute(format!(
            r#"mutation {{
                update_module_presentation(
                    module_id: "{module_id}",
                    tab_hidden: {tab_hidden}
                ) {{ moduleId rank tabHidden }}
            }}"#
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    presentation::Entity::find_by_id(module_id)
        .one(database)
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn first_drag_seeds_active_modules_once_and_preserves_visibility() {
    let (_directory, database) = fixture().await;
    update_visibility(&database, B, true).await;

    reorder::reorder_module_presentation(
        &database,
        move_module(A, None, Some(C), Some(vec![C, B, A])),
        None,
    )
    .await
    .unwrap();

    let rows = presentations(&database).await;
    assert_eq!(rows.len(), 3);
    assert!(!rows.iter().any(|row| row.module_id == ARCHIVED));
    assert!(
        rows.iter()
            .find(|row| row.module_id == B)
            .unwrap()
            .tab_hidden
    );
    assert_eq!(active_order(&database).await, ["a", "c", "b"]);
}

#[tokio::test]
async fn later_drag_updates_one_rank_and_rejects_stale_neighbors() {
    let (_directory, database) = fixture().await;
    reorder::reorder_module_presentation(
        &database,
        move_module(A, None, Some(C), Some(vec![C, B, A])),
        None,
    )
    .await
    .unwrap();
    let before: std::collections::HashMap<_, _> = presentations(&database)
        .await
        .into_iter()
        .map(|row| (row.module_id, (row.rank, row.tab_hidden)))
        .collect();

    reorder::reorder_module_presentation(&database, move_module(A, Some(C), Some(B), None), None)
        .await
        .unwrap();
    let after: std::collections::HashMap<_, _> = presentations(&database)
        .await
        .into_iter()
        .map(|row| (row.module_id, (row.rank, row.tab_hidden)))
        .collect();
    assert_eq!(before[B], after[B]);
    assert_eq!(before[C], after[C]);
    assert_ne!(before[A].0, after[A].0);
    assert_eq!(active_order(&database).await, ["c", "a", "b"]);

    let error =
        reorder::reorder_module_presentation(&database, move_module(A, Some(C), None, None), None)
            .await
            .unwrap_err();
    assert_eq!(error.to_string(), "before/after are not ordered neighbors.");
    assert_eq!(active_order(&database).await, ["c", "a", "b"]);
}

#[tokio::test]
async fn visibility_preserves_rank_and_an_empty_rank_does_not_enable_manual_order() {
    let (_directory, database) = fixture().await;
    let hidden = update_visibility(&database, B, true).await;
    assert_eq!((hidden.rank.as_str(), hidden.tab_hidden), ("", true));
    assert_eq!(active_order(&database).await, ["c", "b", "a"]);

    let mut ranked: presentation::ActiveModel = hidden.into();
    ranked.rank = Set("existing-rank".to_owned());
    ranked.update(&database).await.unwrap();

    let shown = update_visibility(&database, B, false).await;
    assert_eq!(
        (shown.rank.as_str(), shown.tab_hidden),
        ("existing-rank", false)
    );
}

#[tokio::test]
async fn visibility_requires_a_valid_module_identity() {
    let (_directory, database) = fixture().await;
    let schema = muxed_studio_lib::query_root::generated_contract_schema(database.clone()).unwrap();

    let invalid = schema
        .execute(
            r#"mutation {
                update_module_presentation(module_id: "not-a-uuid", tab_hidden: true) {
                    moduleId
                }
            }"#,
        )
        .await;
    let invalid = serde_json::to_value(invalid).unwrap();
    assert_eq!(
        invalid["errors"][0]["extensions"]["code"],
        "field_validation"
    );
    assert_eq!(invalid["errors"][0]["extensions"]["field"], "module_id");

    let mut task: issue::ActiveModel = issue::Entity::find_by_id(B)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .into();
    task.r#type = Set("task".to_owned());
    task.update(&database).await.unwrap();
    let wrong_type = schema
        .execute(format!(
            r#"mutation {{
                update_module_presentation(module_id: "{B}", tab_hidden: true) {{
                    moduleId
                }}
            }}"#
        ))
        .await;
    let wrong_type = serde_json::to_value(wrong_type).unwrap();
    assert_eq!(wrong_type["errors"][0]["extensions"]["code"], "not_found");
    assert!(presentation::Entity::find_by_id(B)
        .one(&database)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn automatic_and_manual_module_creation_use_their_canonical_front() {
    let (_directory, database) = fixture().await;
    let automatic = work_items::create(
        &database,
        work_items::CreateWorkItem {
            project_id: PROJECT.to_owned(),
            name: "automatic-new".to_owned(),
            issue_type_id: MODULE_TYPE.to_owned(),
            description: None,
            state_id: None,
            parent_id: None,
        },
        None,
    )
    .await
    .unwrap();
    assert!(presentation::Entity::find_by_id(&automatic)
        .one(&database)
        .await
        .unwrap()
        .is_none());
    assert_eq!(active_order(&database).await[0], "automatic-new");

    reorder::reorder_module_presentation(
        &database,
        move_module(A, None, Some(&automatic), Some(vec![&automatic, C, B, A])),
        None,
    )
    .await
    .unwrap();
    let mut archived: issue::ActiveModel = issue::Entity::find_by_id(A)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .into();
    archived.is_archived = Set(true);
    archived.update(&database).await.unwrap();
    let first_active_rank = presentation::Entity::find_by_id(&automatic)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .rank;

    let manual = work_items::create(
        &database,
        work_items::CreateWorkItem {
            project_id: PROJECT.to_owned(),
            name: "manual-new".to_owned(),
            issue_type_id: MODULE_TYPE.to_owned(),
            description: None,
            state_id: None,
            parent_id: None,
        },
        None,
    )
    .await
    .unwrap();
    let manual_rank = presentation::Entity::find_by_id(manual)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .rank;
    assert!(manual_rank < first_active_rank);
    assert_eq!(active_order(&database).await[0], "manual-new");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_first_drags_serialize_and_seed_one_complete_order() {
    let (_directory, database) = fixture().await;
    let requests = [database.clone(), database.clone()].map(|database| {
        tokio::spawn(async move {
            reorder::reorder_module_presentation(
                &database,
                move_module(A, None, Some(C), Some(vec![C, B, A])),
                None,
            )
            .await
        })
    });
    for request in requests {
        request.await.unwrap().unwrap();
    }
    assert_eq!(presentations(&database).await.len(), 3);
    assert_eq!(active_order(&database).await, ["a", "c", "b"]);
}

#[tokio::test]
async fn graphql_contract_allowlists_visibility_and_records_reorder() {
    let sdl = muxed_studio_lib::graphql_foundation::generated_schema_sdl()
        .await
        .unwrap();
    let mutation = sdl
        .split("type Mutation {")
        .nth(1)
        .and_then(|value| value.split('}').next())
        .unwrap();
    assert!(
        mutation.contains("update_module_presentation(module_id: String!, tab_hidden: Boolean!)")
    );
    assert!(mutation.contains("reorder_module_presentation(module_id: String!"));
    assert!(!mutation.contains("update_module_presentation(module_id: String!, rank:"));
    assert!(!sdl.contains("worktrackerModulepresentationUpdate"));
}
