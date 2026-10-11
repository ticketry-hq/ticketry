use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, Schema};
use ticketry_entities::{
    agent_run, issue, project, session, sprint, sprint_goal, sprint_suggestion,
};

const PROJECT: &str = "10000000000000000000000000000000";
const SPRINT: &str = "20000000000000000000000000000000";
const GOAL: &str = "30000000000000000000000000000000";
const ISSUE: &str = "40000000000000000000000000000000";
const SUGGESTION: &str = "50000000000000000000000000000000";
const RUN: &str = "70000000-0000-0000-0000-000000000000";

#[tokio::test]
async fn start_sprint_accepts_null_or_omitted_carryover_but_rejects_a_destination() {
    let frontend_operations = include_str!("../../src/features/sprints/operations/sprints.graphql");
    let update_sprint = frontend_operations
        .split("mutation UpdateSprint(")
        .nth(1)
        .expect("frontend UpdateSprint operation")
        .split("query SprintSuggestions")
        .next()
        .unwrap();
    let update_sprint = format!("mutation UpdateSprint({update_sprint}");
    for (label, query, variables) in [
        (
            "omitted variable",
            update_sprint.clone(),
            serde_json::json!({ "id": SPRINT, "status": "active" }),
        ),
        (
            "explicit null",
            update_sprint.clone(),
            serde_json::json!({ "id": SPRINT, "status": "active", "carryoverSprintId": null }),
        ),
        (
            "omitted argument",
            format!(
                r#"mutation {{ update_sprint(id: "{SPRINT}", status: "active") {{ id status }} }}"#
            ),
            serde_json::json!({}),
        ),
    ] {
        let database = fixture().await;
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
        .expect("build shipping schema");
        let rejected = schema
            .execute(async_graphql::Request::new(&update_sprint).variables(
                async_graphql::Variables::from_json(serde_json::json!({
                    "id": SPRINT, "status": "active", "carryoverSprintId": PROJECT,
                })),
            ))
            .await;
        assert_eq!(rejected.errors.len(), 1, "{label}: {:?}", rejected.errors);
        assert!(
            rejected.errors[0]
                .message
                .contains("Carry-over applies only when completing a sprint."),
            "{:?}",
            rejected.errors
        );
        let response = schema
            .execute(
                async_graphql::Request::new(query)
                    .variables(async_graphql::Variables::from_json(variables)),
            )
            .await;
        assert!(response.errors.is_empty(), "{label}: {:?}", response.errors);
        let data = serde_json::to_value(response.data).unwrap();
        assert_eq!(data["update_sprint"]["status"], "active", "{label}");
        let persisted = schema.execute(format!(r#"query {{ worktrackerSprint(filters: {{ id: {{ eq: "{SPRINT}" }} }}) {{ nodes {{ status }} }} }}"#)).await;
        assert!(
            persisted.errors.is_empty(),
            "{label}: {:?}",
            persisted.errors
        );
        assert_eq!(
            serde_json::to_value(persisted.data).unwrap()["worktrackerSprint"]["nodes"][0]
                ["status"],
            "active",
            "{label}"
        );
    }
}

async fn fixture() -> DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1).min_connections(1);
    let database = Database::connect(options)
        .await
        .expect("open sprint fixture");
    database
        .execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .expect("allow isolated entity fixture without unrelated tables");
    let backend = database.get_database_backend();
    let schema = Schema::new(backend);
    for table in [
        schema.create_table_from_entity(project::Entity),
        schema.create_table_from_entity(issue::Entity),
        schema.create_table_from_entity(agent_run::Entity),
        schema.create_table_from_entity(session::Entity),
        schema.create_table_from_entity(sprint::Entity),
        schema.create_table_from_entity(sprint_goal::Entity),
        schema.create_table_from_entity(sprint_suggestion::Entity),
    ] {
        database
            .execute_raw(backend.build(&table))
            .await
            .expect("create entity table");
    }
    let namespace = ticketry_terminal::current_runtime_namespace().expect("runtime namespace");
    database
        .execute_unprepared(&format!(
            r#"
        INSERT INTO worktracker_project
            (id, name, slug, description, seq_counter, state_revision,
             created_at, updated_at, onboarding_required)
        VALUES ('{PROJECT}', 'Planning', 'PLAN', '', 1, 0,
                '2026-10-03 00:00:00', '2026-10-03 00:00:00', 0);
        INSERT INTO worktracker_issue
            (id, project_id, type, issue_type_id, state_revision, name, sequence_id,
             is_archived, rank, description, workspace_tab_order, created_at,
             updated_at, sprint_id)
        VALUES ('{ISSUE}', '{PROJECT}', 'task', '60000000000000000000000000000000',
                0, 'Ship planning', 1, 0, 'A', '', '[]',
                '2026-10-03 00:00:00', '2026-10-03 00:00:00', '{SPRINT}');
        INSERT INTO agent_runs
            (id, issue_id, status, started_at, scope, launch_unattended)
        VALUES ('{RUN}', '{ISSUE}', 'completed', '2026-10-03T00:00:00Z', 'sprint', 0);
        INSERT INTO agent_terminal_sessions
            (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at,
             scope, runtime_cleanup_pending, runtime_namespace, output_sequence)
        VALUES ('{RUN}', 'sprint-relation-fixture', '{ISSUE}', '{ISSUE}', '{PROJECT}',
                '2026-10-03T00:00:00Z', 'sprint', 0, '{namespace}', 0);
        INSERT INTO worktracker_sprint
            (id, project_id, name, status, suggestion_run_id, rank, created_at, updated_at)
        VALUES ('{SPRINT}', '{PROJECT}', 'Sprint one', 'planned', '{RUN}', 'a0',
                '2026-10-03 00:00:00', '2026-10-03 00:00:00');
        INSERT INTO worktracker_sprint_goal
            (id, sprint_id, position, text, created_at, updated_at)
        VALUES ('{GOAL}', '{SPRINT}', 0, 'Ship the sprint planner',
                '2026-10-03 00:00:00', '2026-10-03 00:00:00');
        INSERT INTO worktracker_sprint_suggestion
            (id, sprint_id, goal_id, issue_id, reason, status, run_id, created_at)
        VALUES ('{SUGGESTION}', '{SPRINT}', '{GOAL}', '{ISSUE}',
                'Delivers the planner', 'waiting', '{RUN}', '2026-10-03 00:00:00');
    "#
        ))
        .await
        .expect("seed sprint relation graph");
    database
}

#[tokio::test]
async fn canonical_sprint_relations_resolve_the_persisted_planning_graph() {
    let database = fixture().await;
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
    .expect("build shipping schema");
    let response = schema
        .execute(format!(
            r#"
        query {{
            worktrackerSprint(filters: {{ id: {{ eq: "{SPRINT}" }} }}) {{
                nodes {{
                    id
                    suggestionRun {{ id status }}
                    goals {{ nodes {{ id text }} }}
                    suggestions {{ nodes {{
                        id
                        goal {{ id text }}
                        issue {{ id name }}
                    }} }}
                    issues {{ nodes {{ id }} }}
                }}
            }}
            worktrackerProject(filters: {{ id: {{ eq: "{PROJECT}" }} }}) {{
                nodes {{ id sprints {{ nodes {{ id }} }} }}
            }}
        }}
    "#
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = serde_json::to_value(response.data).expect("encode sprint query result");
    assert_eq!(
        data,
        serde_json::json!({
            "worktrackerSprint": { "nodes": [{
                "id": "20000000-0000-0000-0000-000000000000",
                "suggestionRun": { "id": RUN, "status": "completed" },
                "goals": { "nodes": [{ "id": "30000000-0000-0000-0000-000000000000", "text": "Ship the sprint planner" }] },
                "suggestions": { "nodes": [{
                    "id": "50000000-0000-0000-0000-000000000000",
                    "goal": { "id": "30000000-0000-0000-0000-000000000000", "text": "Ship the sprint planner" },
                    "issue": { "id": "40000000-0000-0000-0000-000000000000", "name": "Ship planning" }
                }] },
                "issues": { "nodes": [{ "id": "40000000-0000-0000-0000-000000000000" }] }
            }] },
            "worktrackerProject": { "nodes": [{
                "id": "10000000-0000-0000-0000-000000000000", "sprints": { "nodes": [{ "id": "20000000-0000-0000-0000-000000000000" }] }
            }] }
        })
    );
}

#[path = "sprint_relations_graphql/story_creation.rs"]
mod story_creation;
