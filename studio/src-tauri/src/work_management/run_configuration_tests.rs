use std::collections::BTreeMap;

use sea_orm::{ConnectionTrait, Database, EntityTrait};

use super::{database::open_for_commands, run_configuration};
use crate::entities::work_management::run_configuration as entity;

const MODULE: &str = "10000000000000000000000000000001";
const STORY: &str = "10000000000000000000000000000002";

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared(&format!(
            r#"
            CREATE TABLE worktracker_issue (
                id char(32) PRIMARY KEY,
                project_id char(32) NOT NULL,
                type varchar(10) NOT NULL,
                issue_type_id char(32) NOT NULL,
                parent_id char(32),
                module_id char(32),
                state_id char(32),
                state_revision bigint NOT NULL,
                name varchar(512) NOT NULL,
                sequence_id integer NOT NULL,
                is_archived bool NOT NULL,
                rank varchar(64) NOT NULL,
                description text NOT NULL,
                created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '20000000000000000000000000000000', 'module', '30000000000000000000000000000000', NULL, NULL, NULL, 0, 'Module', 1, 0, 'a', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{STORY}', '20000000000000000000000000000000', 'task', '30000000000000000000000000000001', NULL, '{MODULE}', NULL, 0, 'Story', 2, 0, 'b', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    drop(writer);
    let database = open_for_commands(&path).await.unwrap();
    (directory, database)
}

#[tokio::test]
async fn migration_and_model_write_store_one_configuration_per_module() {
    let (_directory, database) = fixture().await;
    let saved = run_configuration::create(
        &database,
        run_configuration::NewRunConfiguration {
            module_id: MODULE.to_owned(),
            command: "npm run dev".to_owned(),
            environment: BTreeMap::from([("PORT".to_owned(), "5174".to_owned())]),
            preview_url: Some("http://127.0.0.1:5174".to_owned()),
        },
    )
    .await
    .unwrap();

    assert_eq!(saved.module_id, MODULE);
    assert_eq!(
        entity::Entity::find().all(&database).await.unwrap(),
        vec![saved]
    );
}

#[tokio::test]
async fn model_write_rejects_non_module_work_items() {
    let (_directory, database) = fixture().await;
    let error = run_configuration::create(
        &database,
        run_configuration::NewRunConfiguration {
            module_id: STORY.to_owned(),
            command: "npm run dev".to_owned(),
            environment: BTreeMap::new(),
            preview_url: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), "run_configuration_module_required");
    assert!(entity::Entity::find()
        .all(&database)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn graphql_contract_exposes_generated_reads_and_identity_bound_writes_only() {
    let (_directory, database) = fixture().await;
    let foundation = Database::connect("sqlite::memory:").await.unwrap();
    let schema = crate::query_root::foundation_schema_with_terminal_services(
        foundation,
        Some(database.clone()),
        Some(super::commands::CommandDatabase(database)),
        None,
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
    assert!(sdl.contains("worktrackerRunconfiguration"));
    assert!(sdl.contains("create_run_configuration"));
    assert!(sdl.contains("update_run_configuration"));
    assert!(sdl.contains("delete_run_configuration"));
    assert!(!sdl.contains("worktrackerRunconfigurationCreateOne"));
    assert!(!sdl.contains("worktrackerRunconfigurationCreateBatch"));
    assert!(!sdl.contains("worktrackerRunconfigurationUpdate"));
    assert!(!sdl.contains("worktrackerRunconfigurationDelete"));

    let response = schema
        .execute(format!(
            r#"mutation {{
              create_run_configuration(
                module_id: "{STORY}",
                command: "npm run dev",
                environment: {{PORT: "5174"}}
              ) {{ moduleId }}
            }}"#
        ))
        .await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        response.errors[0]
            .extensions
            .as_ref()
            .and_then(|values| values.get("code")),
        Some(&async_graphql::Value::from(
            "run_configuration_module_required"
        ))
    );
}

#[tokio::test]
async fn graphql_update_preserves_omitted_run_configuration_fields() {
    let (_directory, database) = fixture().await;
    let foundation = Database::connect("sqlite::memory:").await.unwrap();
    let schema = crate::query_root::foundation_schema_with_terminal_services(
        foundation,
        Some(database.clone()),
        Some(super::commands::CommandDatabase(database)),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let created = schema
        .execute(format!(
            r#"mutation {{
              create_run_configuration(
                module_id: "{MODULE}",
                command: "npm run dev",
                environment: {{PORT: "5174"}},
                preview_url: "http://127.0.0.1:5174"
              ) {{ moduleId }}
            }}"#
        ))
        .await;
    assert!(created.errors.is_empty(), "{:?}", created.errors);

    let updated = schema
        .execute(format!(
            r#"mutation {{
              update_run_configuration(
                module_id: "{MODULE}",
                command: "npm run desktop:dev"
              ) {{ command environment previewUrl }}
            }}"#
        ))
        .await;

    assert!(updated.errors.is_empty(), "{:?}", updated.errors);
    assert_eq!(
        updated.data,
        async_graphql::value!({
            "update_run_configuration": {
                "command": "npm run desktop:dev",
                "environment": {"PORT": "5174"},
                "previewUrl": "http://127.0.0.1:5174",
            }
        })
    );
}
