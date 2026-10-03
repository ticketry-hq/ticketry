#![allow(dead_code)]
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Schema};
use seaography::async_graphql::dynamic::Schema as GraphqlSchema;
use ticketry_entities::{
    issue, issue_type, project, sprint, sprint_goal, sprint_suggestion, state,
};
use ticketry_work_management::commands::{status_facts::WorkFactRecorder, CommandDatabase};

pub const PROJECT: &str = "20000000-0000-0000-0000-000000000001";
pub const SPRINT: &str = "10000000-0000-0000-0000-000000000001";
pub const GOAL: &str = "30000000-0000-0000-0000-000000000001";
pub const STORY: &str = "50000000-0000-0000-0000-000000000001";
pub const EPIC: &str = "50000000-0000-0000-0000-000000000002";
pub const RUN: &str = "run-with-opaque-id";
pub struct Fixture {
    pub db: DatabaseConnection,
    pub schema: GraphqlSchema,
}

pub async fn fixture() -> Fixture {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1);
    let db = Database::connect(options).await.unwrap();
    db.execute_unprepared("PRAGMA foreign_keys = OFF")
        .await
        .unwrap();
    let ddl = Schema::new(DbBackend::Sqlite);
    for table in [
        ddl.create_table_from_entity(project::Entity),
        ddl.create_table_from_entity(issue::Entity),
        ddl.create_table_from_entity(issue_type::Entity),
        ddl.create_table_from_entity(state::Entity),
        ddl.create_table_from_entity(sprint::Entity),
        ddl.create_table_from_entity(sprint_goal::Entity),
        ddl.create_table_from_entity(sprint_suggestion::Entity),
    ] {
        db.execute_raw(DbBackend::Sqlite.build(&table))
            .await
            .unwrap();
    }
    db.execute_unprepared("CREATE UNIQUE INDEX goal_position ON worktracker_sprint_goal(sprint_id, position);
        CREATE TABLE runs_status_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL, event_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
        subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, agent_run_id TEXT,
        automation_attempt_id TEXT, work_item_id TEXT, payload TEXT NOT NULL,
        committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO worktracker_project
        (id, name, slug, description, seq_counter, state_revision, created_at, updated_at, onboarding_required) VALUES
        ('20000000000000000000000000000001', 'Project', 'project', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
        INSERT INTO worktracker_state (id, project_id, name, \"group\", color, sort_order, is_protected, created_at, updated_at) VALUES
        ('80000000000000000000000000000001', '20000000000000000000000000000001', 'Ideas', 'backlog', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issuetype (id, project_id, name, level, color, sort_order, start_state_id, workflow_revision, is_pathfind, created_at, updated_at) VALUES
        ('70000000000000000000000000000001', '20000000000000000000000000000001', 'Story', 'task', '', 1, '80000000000000000000000000000001', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_sprint (id, project_id, name, status, suggestion_run_id, created_at, updated_at) VALUES
        ('10000000000000000000000000000001', '20000000000000000000000000000001', 'Sprint', 'planned', 'run-with-opaque-id', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_sprint_goal (id, sprint_id, position, text, created_at, updated_at) VALUES
        ('30000000000000000000000000000001', '10000000000000000000000000000001', 1, 'Ship planning', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issue (id, project_id, type, issue_type_id, state_id, state_revision, name, sequence_id, is_archived, rank, description, workspace_tab_order, created_at, updated_at) VALUES
        ('50000000000000000000000000000001', '20000000000000000000000000000001', 'task', '70000000000000000000000000000001', '80000000000000000000000000000001', 1, 'Existing', 1, 0, 'A', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('50000000000000000000000000000002', '20000000000000000000000000000001', 'module', '70000000000000000000000000000001', NULL, 1, 'Epic', 2, 0, '', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);").await.unwrap();
    let facts = WorkFactRecorder::new(
        ticketry_runs::RunsServices::new(db.clone())
            .outbox()
            .events()
            .clone(),
    );
    let schema = ticketry_graphql_schema::foundation_schema(
        db.clone(),
        Some(db.clone()),
        Some(CommandDatabase(db.clone())),
        None,
        None,
        None,
        Some(facts),
        None,
        None,
    )
    .unwrap();
    Fixture { db, schema }
}
