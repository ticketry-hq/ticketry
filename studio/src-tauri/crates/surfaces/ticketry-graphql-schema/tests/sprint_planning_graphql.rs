use sea_orm::{ConnectionTrait, Database, DbBackend, Schema};
use seaography::async_graphql::{Request, Variables};
use serde_json::json;
use ticketry_entities::{issue, sprint, sprint_goal, sprint_suggestion};

#[tokio::test]
async fn planning_reads_filter_by_hyphenated_sprint_ids_and_return_public_ids() {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .unwrap();
    let ddl = Schema::new(DbBackend::Sqlite);
    for table in [
        ddl.create_table_from_entity(sprint::Entity),
        ddl.create_table_from_entity(sprint_goal::Entity),
        ddl.create_table_from_entity(sprint_suggestion::Entity),
        ddl.create_table_from_entity(issue::Entity),
    ] {
        database
            .execute_raw(DbBackend::Sqlite.build(&table))
            .await
            .unwrap();
    }
    database.execute_unprepared(
        "INSERT INTO worktracker_sprint
         (id, project_id, name, status, suggestion_run_id, created_at, updated_at) VALUES
         ('10000000000000000000000000000001', '20000000000000000000000000000001', 'First', 'planned', '60000000000000000000000000000001', '2026-10-03 00:00:00', '2026-10-03 00:00:00'),
         ('10000000000000000000000000000002', '20000000000000000000000000000001', 'Other', 'planned', NULL, '2026-10-03 00:00:00', '2026-10-03 00:00:00');
         INSERT INTO worktracker_sprint_goal
         (id, sprint_id, position, text, created_at, updated_at) VALUES
         ('30000000000000000000000000000001', '10000000000000000000000000000001', 1, 'Ship planning', '2026-10-03 00:00:00', '2026-10-03 00:00:00'),
         ('30000000000000000000000000000002', '10000000000000000000000000000002', 1, 'Other goal', '2026-10-03 00:00:00', '2026-10-03 00:00:00');
         INSERT INTO worktracker_sprint_suggestion
         (id, sprint_id, goal_id, issue_id, proposed_name, proposed_epic_id, reason, status, run_id, created_at) VALUES
         ('40000000000000000000000000000001', '10000000000000000000000000000001', '30000000000000000000000000000001', '50000000000000000000000000000001', NULL, NULL, 'Fits G1', 'waiting', '60000000000000000000000000000001', '2026-10-03 00:00:00'),
         ('40000000000000000000000000000002', '10000000000000000000000000000002', '30000000000000000000000000000002', NULL, 'New story', '50000000000000000000000000000002', 'Fits other', 'waiting', '60000000000000000000000000000002', '2026-10-03 00:00:00');
         INSERT INTO worktracker_issue
         (id, project_id, type, issue_type_id, sprint_id, state_revision, name, sequence_id, is_archived, rank, description, workspace_tab_order, created_at, updated_at) VALUES
         ('50000000000000000000000000000001', '20000000000000000000000000000001', 'task', '70000000000000000000000000000001', '10000000000000000000000000000001', 1, 'Selected story', 1, 0, 'A', '', '[]', '2026-10-03 00:00:00', '2026-10-03 00:00:00'),
         ('50000000000000000000000000000002', '20000000000000000000000000000001', 'module', '70000000000000000000000000000002', '10000000000000000000000000000002', 1, 'Other epic', 2, 0, 'B', '', '[]', '2026-10-03 00:00:00', '2026-10-03 00:00:00');"
    ).await.unwrap();
    let schema = ticketry_graphql_schema::generated_contract_schema(database).unwrap();
    let response = schema.execute(Request::new(
        "query($sprint: String!) {
            worktrackerSprint(filters: {id: {eq: $sprint}}) { nodes { id projectId suggestionRunId } }
            worktrackerSprintGoal(filters: {sprintId: {eq: $sprint}}) { nodes { id sprintId } }
            worktrackerSprintSuggestion(filters: {sprintId: {eq: $sprint}}) { nodes { id sprintId goalId issueId proposedEpicId runId } }
            worktrackerIssue(filters: {sprintId: {eq: $sprint}}) { nodes { id sprintId } }
        }"
    ).variables(Variables::from_json(json!({"sprint": "10000000-0000-0000-0000-000000000001"})))).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        json!({
            "worktrackerSprint": {"nodes": [{"id": "10000000-0000-0000-0000-000000000001", "projectId": "20000000-0000-0000-0000-000000000001", "suggestionRunId": "60000000000000000000000000000001"}]},
            "worktrackerSprintGoal": {"nodes": [{"id": "30000000-0000-0000-0000-000000000001", "sprintId": "10000000-0000-0000-0000-000000000001"}]},
            "worktrackerSprintSuggestion": {"nodes": [{"id": "40000000-0000-0000-0000-000000000001", "sprintId": "10000000-0000-0000-0000-000000000001", "goalId": "30000000-0000-0000-0000-000000000001", "issueId": "50000000-0000-0000-0000-000000000001", "proposedEpicId": null, "runId": "60000000000000000000000000000001"}]},
            "worktrackerIssue": {"nodes": [{"id": "50000000-0000-0000-0000-000000000001", "sprintId": "10000000-0000-0000-0000-000000000001"}]}
        })
    );
}
