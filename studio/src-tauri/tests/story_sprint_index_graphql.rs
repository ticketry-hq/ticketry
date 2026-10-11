use sea_orm::{ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, Schema, Set};
use ticketry_entities::{issue, project};

const PROJECT: &str = "10000000000000000000000000000000";
const FOREIGN: &str = "10000000000000000000000000000001";

#[tokio::test]
async fn generated_project_root_read_is_complete_and_excludes_non_roots() {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1).min_connections(1);
    let database = Database::connect(options).await.unwrap();
    database
        .execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .unwrap();
    let backend = database.get_database_backend();
    let tables = Schema::new(backend);
    for table in [
        tables.create_table_from_entity(project::Entity),
        tables.create_table_from_entity(issue::Entity),
    ] {
        database.execute_raw(backend.build(&table)).await.unwrap();
    }
    let now = chrono::NaiveDate::from_ymd_opt(2026, 10, 8)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap();
    for (id, slug) in [(PROJECT, "LOCAL"), (FOREIGN, "OTHER")] {
        project::ActiveModel {
            id: Set(id.into()),
            name: Set(slug.into()),
            slug: Set(slug.into()),
            description: Set("".into()),
            seq_counter: Set(1),
            state_revision: Set(0),
            created_at: Set(now),
            updated_at: Set(now),
            onboarding_required: Set(false),
        }
        .insert(&database)
        .await
        .unwrap();
    }
    // Two direct roots, one in an unopened module, with every excluded shape.
    for (n, owner, kind, parent, module, archived) in [
        (2, PROJECT, "module", None, None, false),
        (3, PROJECT, "module", None, None, false),
        (4, PROJECT, "module", None, None, true),
        (5, FOREIGN, "module", None, None, false),
        (6, PROJECT, "task", Some(2), Some(2), false),
        (7, PROJECT, "task", Some(3), Some(3), false),
        (8, PROJECT, "task", Some(6), Some(2), false),
        (9, PROJECT, "task", Some(99), Some(2), false),
        (10, PROJECT, "task", Some(2), Some(2), true),
        (11, PROJECT, "task", Some(4), Some(4), false),
        (12, FOREIGN, "task", Some(5), Some(5), false),
        (13, PROJECT, "task", Some(5), Some(5), false),
    ] {
        issue::ActiveModel {
            id: Set(format!("{n:032x}")),
            project_id: Set(owner.into()),
            r#type: Set(kind.into()),
            issue_type_id: Set("90000000000000000000000000000000".into()),
            parent_id: Set(parent.map(|id| format!("{id:032x}"))),
            module_id: Set(module.map(|id| format!("{id:032x}"))),
            state_id: Set(None),
            sprint_id: Set((n == 6 || n == 8).then(|| "20000000000000000000000000000000".into())),
            state_revision: Set(0),
            name: Set(format!("Record {n}")),
            sequence_id: Set(n),
            is_archived: Set(archived),
            rank: Set("V".into()),
            description: Set("".into()),
            workspace_tab_order: Set(serde_json::json!([])),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&database)
        .await
        .unwrap();
    }
    let schema = ticketry_graphql_schema::foundation_schema(
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
    .unwrap();
    let operation =
        include_str!("../../src/features/work-items/operations/storySprintIndex.graphql");
    let modules_response = schema
        .execute(
            async_graphql::Request::new(operation)
                .operation_name("ProjectStorySprintModules")
                .variables(async_graphql::Variables::from_json(
                    serde_json::json!({"projectId": PROJECT}),
                )),
        )
        .await;
    assert!(
        modules_response.errors.is_empty(),
        "{:?}",
        modules_response.errors
    );
    let modules_data = serde_json::to_value(modules_response.data).unwrap();
    assert_eq!(
        modules_data["modules"]["nodes"].as_array().unwrap().len(),
        2
    );
    assert_eq!(modules_data["modules"]["pageInfo"]["hasNextPage"], false);
    let module_ids: Vec<_> = modules_data["modules"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node["id"].clone())
        .collect();
    let response = schema
        .execute(
            async_graphql::Request::new(operation)
                .operation_name("ProjectStorySprintIndex")
                .variables(async_graphql::Variables::from_json(
                    serde_json::json!({"projectId": PROJECT,"moduleIds":module_ids}),
                )),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = serde_json::to_value(response.data).unwrap();
    assert_eq!(data["roots"]["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(
        data["roots"]["nodes"][0]["id"],
        "00000000-0000-0000-0000-000000000006"
    );
    assert_eq!(
        data["roots"]["nodes"][1]["id"],
        "00000000-0000-0000-0000-000000000007"
    );
    assert_eq!(
        data["roots"]["nodes"][0]["sprint_id"],
        "20000000-0000-0000-0000-000000000000"
    );
    assert!(data["roots"]["nodes"][1]["sprint_id"].is_null());
    assert_eq!(data["roots"]["pageInfo"]["hasNextPage"], false);
    assert_eq!(data["roots"]["paginationInfo"]["total"], 2);
}
