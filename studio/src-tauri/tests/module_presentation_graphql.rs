use muxed_studio_lib::{
    entities::work_management::{issue, module_presentation},
    query_root,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectOptions, ConnectionTrait, Database,
    DatabaseConnection, EntityTrait,
};

const PROJECT: &str = "10000000000000000000000000000000";
const MODULE_TYPE: &str = "20000000000000000000000000000000";
const MODULE: &str = "30000000000000000000000000000001";

async fn fixture() -> DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1).min_connections(1);
    let database = Database::connect(options).await.unwrap();
    database
        .execute_unprepared(&format!(
            r#"
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
            INSERT INTO worktracker_issue VALUES (
                '{MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL, NULL,
                0, 'Module', 1, 0, 'legacy-rank', '', '[]',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            );
            "#,
        ))
        .await
        .unwrap();
    database
}

fn schema(database: DatabaseConnection) -> seaography::async_graphql::dynamic::Schema {
    query_root::foundation_schema(
        database.clone(),
        Some(database),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap()
}

#[tokio::test]
async fn visibility_materializes_and_updates_without_changing_rank() {
    let database = fixture().await;
    let schema = schema(database.clone());

    let materialized = schema
        .execute(format!(
            r#"mutation {{
                update_module_presentation(module_id: "{MODULE}", tab_hidden: true) {{
                    moduleId rank tabHidden
                }}
            }}"#
        ))
        .await;
    assert!(materialized.errors.is_empty(), "{:?}", materialized.errors);
    let row = module_presentation::Entity::find_by_id(MODULE)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((row.rank.as_str(), row.tab_hidden), ("", true));

    let mut ranked: module_presentation::ActiveModel = row.into();
    ranked.rank = Set("existing-rank".to_owned());
    ranked.update(&database).await.unwrap();
    let updated = schema
        .execute(format!(
            r#"mutation {{
                update_module_presentation(module_id: "{MODULE}", tab_hidden: false) {{
                    rank tabHidden
                }}
            }}"#
        ))
        .await;
    assert!(updated.errors.is_empty(), "{:?}", updated.errors);
    let updated = serde_json::to_value(updated.data).unwrap();
    assert_eq!(
        updated["update_module_presentation"]["rank"],
        "existing-rank"
    );
    assert_eq!(updated["update_module_presentation"]["tabHidden"], false);
}

#[tokio::test]
async fn visibility_requires_a_valid_module_identity() {
    let database = fixture().await;
    let schema = schema(database.clone());
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

    let mut task: issue::ActiveModel = issue::Entity::find_by_id(MODULE)
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
                update_module_presentation(module_id: "{MODULE}", tab_hidden: true) {{
                    moduleId
                }}
            }}"#
        ))
        .await;
    let wrong_type = serde_json::to_value(wrong_type).unwrap();
    assert_eq!(wrong_type["errors"][0]["extensions"]["code"], "not_found");
}

#[tokio::test]
async fn visibility_contract_keeps_identity_required_and_rank_read_only() {
    let sdl = schema(fixture().await).sdl();
    let mutation = sdl
        .split("type Mutation {")
        .nth(1)
        .and_then(|value| value.split('}').next())
        .unwrap();
    assert!(
        mutation.contains("update_module_presentation(module_id: String!, tab_hidden: Boolean!)")
    );
    assert!(mutation.contains(
        "reorder_module_presentation(module_id: String!, before_id: String, after_id: String, initial_order_ids: [String!])"
    ));
    assert!(!mutation.contains("update_module_presentation(module_id: String!, rank:"));
    assert!(!sdl.contains("worktrackerModulepresentationUpdate"));
}
