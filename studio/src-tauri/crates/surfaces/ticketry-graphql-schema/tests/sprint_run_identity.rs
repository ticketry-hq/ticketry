use sea_orm::{ConnectOptions, ConnectionTrait, Database, DbBackend, Schema, Statement};
use seaography::async_graphql::{dynamic::Schema as GraphqlSchema, Request, Variables};
use serde_json::{json, Value};
use ticketry_entities::{
    agent_run, issue, project, session, sprint, sprint_goal, sprint_suggestion,
};
use ticketry_work_management::commands::CommandDatabase;

const RUN_ID: &str = "ab34cd56ef78901234567890abcdef12";
const SPRINT_ID: &str = "10000000-0000-0000-0000-000000000001";
const UPDATE_RUN: &str = "mutation($sprint: String!, $run: String!) {
    update_sprint(id: $sprint, suggestion_run_id: $run) { id suggestionRunId }
}";
const READ_RUN: &str = "query($sprint: String!, $run: String!) {
    worktrackerSprint(filters: {id: {eq: $sprint}}) {
        nodes {
            id suggestionRunId
            suggestionRun { id status }
            suggestions { nodes { id runId status } }
        }
    }
    agentRuns(filters: {id: {eq: $run}, status: {eq: \"running\"}}) {
        nodes { id status }
    }
}";

async fn execute(schema: &GraphqlSchema, query: &str, variables: Value) -> Value {
    let response = schema
        .execute(Request::new(query).variables(Variables::from_json(variables)))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    response.data.into_json().unwrap()
}

#[tokio::test]
async fn opaque_run_ids_round_trip_and_reset_preserves_waiting_suggestions() {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1);
    let database = Database::connect(options).await.unwrap();
    database
        .execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .unwrap();
    let ddl = Schema::new(DbBackend::Sqlite);
    for table in [
        ddl.create_table_from_entity(project::Entity),
        ddl.create_table_from_entity(sprint::Entity),
        ddl.create_table_from_entity(sprint_goal::Entity),
        ddl.create_table_from_entity(sprint_suggestion::Entity),
        ddl.create_table_from_entity(issue::Entity),
        ddl.create_table_from_entity(agent_run::Entity),
        ddl.create_table_from_entity(session::Entity),
    ] {
        database
            .execute_raw(DbBackend::Sqlite.build(&table))
            .await
            .unwrap();
    }
    database.execute_unprepared(
        "INSERT INTO worktracker_project
         (id, name, slug, description, seq_counter, state_revision, created_at, updated_at, onboarding_required) VALUES
         ('20000000000000000000000000000001', 'Project', 'project', '', 1, 1, '2026-10-03 00:00:00', '2026-10-03 00:00:00', 0);
         INSERT INTO worktracker_sprint
         (id, project_id, name, status, created_at, updated_at) VALUES
         ('10000000000000000000000000000001', '20000000000000000000000000000001', 'Planning', 'planned', '2026-10-03 00:00:00', '2026-10-03 00:00:00');
         INSERT INTO worktracker_sprint_goal
         (id, sprint_id, position, text, created_at, updated_at) VALUES
         ('30000000000000000000000000000001', '10000000000000000000000000000001', 1, 'Ship planning', '2026-10-03 00:00:00', '2026-10-03 00:00:00');
         INSERT INTO worktracker_issue
         (id, project_id, type, issue_type_id, state_revision, name, sequence_id, is_archived, rank, description, workspace_tab_order, created_at, updated_at) VALUES
         ('50000000000000000000000000000001', '20000000000000000000000000000001', 'task', '70000000000000000000000000000001', 1, 'Planner', 1, 0, 'A', '', '[]', '2026-10-03 00:00:00', '2026-10-03 00:00:00');
         INSERT INTO agent_runs
         (id, issue_id, agent, status, started_at, scope, launch_unattended) VALUES
         ('ab34cd56ef78901234567890abcdef12', '50000000000000000000000000000001', 'codex', 'running', '2026-10-03T00:00:00Z', 'task', 0);"
    ).await.unwrap();
    let runtime_namespace = ticketry_terminal::current_runtime_namespace().unwrap();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO agent_terminal_sessions
             (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at,
              scope, runtime_cleanup_pending, runtime_namespace, output_sequence, agent) VALUES
             (?, 'planner-test', '50000000000000000000000000000001',
              '50000000000000000000000000000001', '20000000000000000000000000000001',
              '2026-10-03T00:00:00Z', 'task', 0, ?, 0, 'codex')",
            [RUN_ID.into(), runtime_namespace.into()],
        ))
        .await
        .unwrap();
    let schema = ticketry_graphql_schema::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(CommandDatabase(database.clone())),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let updated = execute(
        &schema,
        UPDATE_RUN,
        json!({"sprint": SPRINT_ID, "run": RUN_ID}),
    )
    .await;
    assert_eq!(
        updated,
        json!({"update_sprint": {"id": SPRINT_ID, "suggestionRunId": RUN_ID}})
    );
    database.execute_unprepared(
        "INSERT INTO worktracker_sprint_suggestion
         (id, sprint_id, goal_id, issue_id, reason, status, run_id, created_at) VALUES
         ('40000000000000000000000000000001', '10000000000000000000000000000001', '30000000000000000000000000000001', '50000000000000000000000000000001', 'Fits G1', 'waiting', 'ab34cd56ef78901234567890abcdef12', '2026-10-03 00:00:00');"
    ).await.unwrap();
    let before = execute(
        &schema,
        READ_RUN,
        json!({"sprint": SPRINT_ID, "run": RUN_ID}),
    )
    .await;
    assert_eq!(
        before,
        json!({
            "worktrackerSprint": {"nodes": [{
                "id": SPRINT_ID,
                "suggestionRunId": RUN_ID,
                "suggestionRun": {"id": RUN_ID, "status": "running"},
                "suggestions": {"nodes": [{
                    "id": "40000000-0000-0000-0000-000000000001",
                    "runId": RUN_ID,
                    "status": "waiting"
                }]}
            }]},
            "agentRuns": {"nodes": [{"id": RUN_ID, "status": "running"}]}
        })
    );
    let returned_run = &before["worktrackerSprint"]["nodes"][0]["suggestionRunId"];
    let reset = execute(
        &schema,
        UPDATE_RUN,
        json!({"sprint": SPRINT_ID, "run": returned_run}),
    )
    .await;
    assert_eq!(reset, updated);
    let after = execute(
        &schema,
        READ_RUN,
        json!({"sprint": SPRINT_ID, "run": returned_run}),
    )
    .await;
    assert_eq!(after, before);
}
