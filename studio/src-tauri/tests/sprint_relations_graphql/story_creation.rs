use super::*;

#[tokio::test]
async fn story_creation_and_sprint_membership_commit_or_roll_back_together() {
    use sea_orm::{EntityTrait, PaginatorTrait};
    use ticketry_entities::{issue_type, state};

    let database = fixture().await;
    let backend = database.get_database_backend();
    let tables = Schema::new(backend);
    for table in [
        tables.create_table_from_entity(issue_type::Entity),
        tables.create_table_from_entity(state::Entity),
    ] {
        database.execute_raw(backend.build(&table)).await.unwrap();
    }
    let story_type = "60000000000000000000000000000000";
    database
        .execute_unprepared(&format!(
            r#"
        INSERT INTO worktracker_issuetype
            (id, project_id, name, level, color, sort_order, workflow_revision,
             is_pathfind, created_at, updated_at)
        VALUES ('{story_type}', '{PROJECT}', 'Story', 'task', '#aaa', 0, 0, 0,
                '2026-10-03 00:00:00', '2026-10-03 00:00:00');
        UPDATE worktracker_sprint SET status = 'active' WHERE id = '{SPRINT}';
    "#
        ))
        .await
        .unwrap();
    let schema = ticketry_graphql_schema::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(ticketry_work_management::CommandDatabase(database.clone())),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let query = format!(
        r#"mutation($sprint: String) {{
        create_work_item(project_id: "{PROJECT}", issue_type_id: "{story_type}",
                         name: "Captured story", sprint_id: $sprint) {{ id sprintId }}
    }}"#
    );
    let response = schema
        .execute(async_graphql::Request::new(&query).variables(
            async_graphql::Variables::from_json(serde_json::json!({"sprint": SPRINT})),
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = serde_json::to_value(response.data).unwrap();
    let id = data["create_work_item"]["id"].as_str().unwrap();
    let stored = issue::Entity::find_by_id(id.replace('-', ""))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.sprint_id.as_deref(), Some(SPRINT));

    for invalid in ["closed", "foreign", "missing"] {
        match invalid {
            "closed" => database.execute_unprepared(&format!("UPDATE worktracker_sprint SET status = 'completed' WHERE id = '{SPRINT}'")).await.unwrap(),
            "foreign" => database.execute_unprepared(&format!("UPDATE worktracker_sprint SET status = 'active', project_id = '{GOAL}' WHERE id = '{SPRINT}'")).await.unwrap(),
            _ => database.execute_unprepared(&format!("DELETE FROM worktracker_sprint WHERE id = '{SPRINT}'")).await.unwrap(),
        };
        let count = issue::Entity::find().count(&database).await.unwrap();
        let before = project::Entity::find_by_id(PROJECT)
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        let rejected = schema
            .execute(async_graphql::Request::new(&query).variables(
                async_graphql::Variables::from_json(serde_json::json!({"sprint": SPRINT})),
            ))
            .await;
        assert_eq!(rejected.errors.len(), 1, "{invalid}: {:?}", rejected.errors);
        assert_eq!(
            issue::Entity::find().count(&database).await.unwrap(),
            count,
            "{invalid}"
        );
        let after = project::Entity::find_by_id(PROJECT)
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (before.seq_counter, before.state_revision),
            (after.seq_counter, after.state_revision),
            "{invalid}"
        );
    }
    let unassigned = schema.execute(async_graphql::Request::new(&query)).await;
    assert!(unassigned.errors.is_empty(), "{:?}", unassigned.errors);
    assert!(
        serde_json::to_value(unassigned.data).unwrap()["create_work_item"]["sprintId"].is_null()
    );
}
