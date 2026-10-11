use sea_orm::{ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, Schema, Set};
use serde_json::{json, Value};
use ticketry_entities::{issue, project, sprint, state};

const PROJECT: &str = "10000000000000000000000000000000";
const FOREIGN: &str = "10000000000000000000000000000001";
const OPERATION: &str =
    include_str!("../../src/features/sprints/operations/storySprintChoices.graphql");

async fn fixture_database() -> sea_orm::DatabaseConnection {
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
        tables.create_table_from_entity(sprint::Entity),
        tables.create_table_from_entity(state::Entity),
        tables.create_table_from_entity(issue::Entity),
    ] {
        database.execute_raw(backend.build(&table)).await.unwrap();
    }
    let timestamp = chrono::NaiveDate::from_ymd_opt(2026, 10, 1)
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
            created_at: Set(timestamp),
            updated_at: Set(timestamp),
            onboarding_required: Set(false),
        }
        .insert(&database)
        .await
        .unwrap();
    }
    for (status, count, prefix) in [("planned", 14, 2), ("completed", 23, 3)] {
        for n in 1..=count {
            // Creation times disagree with ranks; ranks for IDs 2 and 3 tie.
            let day = if n >= count - 1 { 1 } else { count + 1 - n };
            let created_at = chrono::NaiveDate::from_ymd_opt(2026, 10, day)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap();
            insert_sprint(
                &database,
                &format!("{prefix:01x}{n:031x}"),
                PROJECT,
                if n == 1 { "Beyond RELEASE" } else { "History" },
                status,
                created_at,
            )
            .await;
        }
        insert_sprint(
            &database,
            &format!("4{prefix:031x}"),
            FOREIGN,
            "Beyond release",
            status,
            timestamp,
        )
        .await;
    }
    insert_sprint(
        &database,
        "50000000000000000000000000000000",
        PROJECT,
        "Current sprint",
        "active",
        timestamp,
    )
    .await;
    database
}

async fn fixture() -> async_graphql::dynamic::Schema {
    ticketry_graphql_schema::generated_contract_schema(fixture_database().await).unwrap()
}

async fn insert_sprint(
    database: &sea_orm::DatabaseConnection,
    id: &str,
    project_id: &str,
    name: &str,
    status: &str,
    created_at: chrono::NaiveDateTime,
) {
    let suffix = usize::from_str_radix(&id[1..], 16).unwrap();
    let position = match suffix {
        1 => 3,
        2 | 3 => 1,
        n => n,
    };
    let prefix = match status {
        "completed" => "H",
        "active" => "J",
        _ => "P",
    };
    sprint::ActiveModel {
        rank: Set(format!("{prefix}{position:04}")),
        id: Set(id.into()),
        project_id: Set(project_id.into()),
        name: Set(name.into()),
        status: Set(status.into()),
        created_at: Set(created_at),
        updated_at: Set(created_at),
        ..Default::default()
    }
    .insert(database)
    .await
    .unwrap();
}

async fn execute(
    schema: &async_graphql::dynamic::Schema,
    operation: &str,
    variables: Value,
) -> Value {
    let response = schema
        .execute(
            async_graphql::Request::new(OPERATION)
                .operation_name(operation)
                .variables(async_graphql::Variables::from_json(variables)),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    response.data.into_json().unwrap()
}

async fn page(
    schema: &async_graphql::dynamic::Schema,
    status: &str,
    offset: usize,
    name: Option<&str>,
    order: Value,
) -> Value {
    let mut filters = json!({"projectId": {"eq": PROJECT}, "status": {"eq": status}});
    if let Some(name) = name {
        filters["name"] = json!({"contains": name});
    }
    execute(
        schema,
        "SprintChoicePage",
        json!({"filters": filters, "order": order, "pagination": {"offset": {"limit": 5, "offset": offset}}}),
    )
    .await["sprints"]
        .clone()
}

fn ids(data: &Value) -> Vec<String> {
    data["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node["id"].as_str().unwrap().to_owned())
        .collect()
}

fn public_ids(prefix: &str, suffixes: &[usize]) -> Vec<String> {
    suffixes
        .iter()
        .map(|n| format!("{prefix}0000000-0000-0000-0000-{n:012x}"))
        .collect()
}

#[tokio::test]
async fn generated_sprint_choices_prioritize_rank_then_id_in_both_directions() {
    let schema = fixture().await;
    // rc.9 reads order fields in model Column::iter order, regardless of the
    // query/input object's field order. Exercise the generated public graph.
    let planned = page(
        &schema,
        "planned",
        0,
        None,
        json!({"rank": "ASC", "id": "ASC"}),
    )
    .await;
    assert_eq!(ids(&planned), public_ids("2", &[2, 3, 1, 4, 5]));
    let completed = page(
        &schema,
        "completed",
        20,
        None,
        json!({"rank": "DESC", "id": "DESC"}),
    )
    .await;
    assert_eq!(ids(&completed), public_ids("3", &[1, 3, 2]));
}

#[tokio::test]
async fn generated_sprint_history_pages_are_status_scoped_complete_and_search_unloaded_names() {
    let schema = fixture().await;
    for (status, total, direction, first, last) in [
        ("planned", 14, "ASC", 2, 14),
        ("completed", 23, "DESC", 23, 2),
    ] {
        let mut loaded = Vec::new();
        for offset in (0..total).step_by(5) {
            let data = page(
                &schema,
                status,
                offset,
                None,
                json!({"rank": direction, "id": direction}),
            )
            .await;
            assert_eq!(data["paginationInfo"]["total"], total);
            assert_eq!(data["pageInfo"]["hasNextPage"], offset + 5 < total);
            let nodes = data["nodes"].as_array().unwrap();
            assert_eq!(nodes.len(), (total - offset).min(5));
            for node in nodes {
                assert_eq!(node["status"], status);
                assert_eq!(node["projectId"], "10000000-0000-0000-0000-000000000000");
            }
            loaded.extend(ids(&data));
        }
        let prefix = if status == "planned" { "2" } else { "3" };
        assert_eq!(loaded.first().unwrap(), &public_ids(prefix, &[first])[0]);
        assert_eq!(loaded.last().unwrap(), &public_ids(prefix, &[last])[0]);
        let unique: std::collections::HashSet<_> = loaded.iter().collect();
        assert_eq!(unique.len(), total);
    }
    // Native SQLite
    // contains is ASCII case insensitive and excludes the foreign namesake.
    for status in ["planned", "completed"] {
        let found = page(
            &schema,
            status,
            0,
            Some("release"),
            json!({"rank": "ASC", "id": "ASC"}),
        )
        .await;
        let prefix = if status == "planned" { "2" } else { "3" };
        assert_eq!(ids(&found), public_ids(prefix, &[1]));
        assert_eq!(found["paginationInfo"]["total"], 1);
        assert_eq!(found["pageInfo"]["hasNextPage"], false);
    }
    let active = execute(&schema, "StoryActiveSprint", json!({"projectId": PROJECT})).await;
    assert_eq!(active["sprints"]["nodes"][0]["name"], "Current sprint");
}

#[tokio::test]
async fn generated_sprint_choices_preserve_single_field_ordering_and_scoped_selected_identity() {
    let schema = fixture().await;
    let by_id = page(&schema, "planned", 0, None, json!({"id": "ASC"})).await;
    assert_eq!(ids(&by_id), public_ids("2", &[1, 2, 3, 4, 5]));
    let latest = page(&schema, "planned", 0, None, json!({"rank": "DESC"})).await;
    assert_eq!(ids(&latest), public_ids("2", &[14, 13, 12, 11, 10]));
    let selected_id = "20000000-0000-0000-0000-000000000001";
    let selected = execute(
        &schema,
        "StorySelectedSprint",
        json!({"projectId": PROJECT, "sprintId": selected_id}),
    )
    .await;
    assert_eq!(selected["sprints"]["nodes"][0]["id"], selected_id);
    let foreign = execute(
        &schema,
        "StorySelectedSprint",
        json!({"projectId": FOREIGN, "sprintId": selected_id}),
    )
    .await;
    assert_eq!(foreign["sprints"]["nodes"], json!([]));
    let missing = execute(
        &schema,
        "StorySelectedSprint",
        json!({"projectId": PROJECT, "sprintId": "60000000-0000-0000-0000-000000000000"}),
    )
    .await;
    assert_eq!(missing["sprints"]["nodes"], json!([]));
}

#[tokio::test]
async fn selected_sprint_identity_survives_native_lifecycle_and_completed_sprints_remain_closed() {
    let database = fixture_database().await;
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
    let update =
        "mutation($id:String!,$status:String!){update_sprint(id:$id,status:$status){id status}}";
    let selected_id = "20000000-0000-0000-0000-000000000001";
    for (id, status) in [
        ("50000000-0000-0000-0000-000000000000", "completed"),
        (selected_id, "active"),
        (selected_id, "completed"),
    ] {
        let response = schema
            .execute(async_graphql::Request::new(update).variables(
                async_graphql::Variables::from_json(json!({"id": id, "status": status})),
            ))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let selected = execute(
            &schema,
            "StorySelectedSprint",
            json!({"projectId": PROJECT, "sprintId": id}),
        )
        .await;
        assert_eq!(selected["sprints"]["nodes"][0]["id"], id);
        assert_eq!(selected["sprints"]["nodes"][0]["status"], status);
    }
    let rejected = schema
        .execute(async_graphql::Request::new(update).variables(
            async_graphql::Variables::from_json(json!({"id": selected_id, "status": "active"})),
        ))
        .await;
    assert!(!rejected.errors.is_empty());
    let selected = execute(
        &schema,
        "StorySelectedSprint",
        json!({"projectId": PROJECT, "sprintId": selected_id}),
    )
    .await;
    assert_eq!(selected["sprints"]["nodes"][0]["status"], "completed");
}
