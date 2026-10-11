use std::path::Path;

use sea_orm::{ConnectionTrait, Database};

pub const OTHER_PROJECT: &str = "70000000-0000-0000-0000-000000000000";
pub const VALIDATION: &str = "40000000-0000-0000-0000-000000000004";

pub async fn add_other_project(directory: &Path) {
    let database = Database::connect(format!("sqlite:{}", directory.join("state.db").display()))
        .await
        .unwrap();
    database
        .execute_unprepared(
            r#"
        INSERT INTO worktracker_project
            (id, name, slug, description, seq_counter, state_revision,
             created_at, updated_at, onboarding_required) VALUES
            ('70000000000000000000000000000000', 'Other project', 'OTHER', '', 42, 0,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
        INSERT INTO worktracker_state
            (id, project_id, name, "group", color, sort_order, is_protected,
             created_at, updated_at) VALUES
            ('80000000000000000000000000000000', '70000000000000000000000000000000',
             'Backlog', 'backlog', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issuetype
            (id, project_id, name, level, color, sort_order, start_state_id,
             workflow_revision, is_pathfind, created_at, updated_at) VALUES
            ('90000000000000000000000000000000', '70000000000000000000000000000000',
             'Story', 'task', '', 0, '80000000000000000000000000000000', 0, 0,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issue
            (id, project_id, type, issue_type_id, state_id, state_revision, name,
             sequence_id, is_archived, rank, description, created_at, updated_at)
            VALUES ('a0000000000000000000000000000000', '70000000000000000000000000000000',
                'task', '90000000000000000000000000000000', '80000000000000000000000000000000',
                0, 'Cross-project work', 42, 0, 'M', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    "#,
        )
        .await
        .unwrap();
    database.close().await.unwrap();
}

pub async fn add_human_only_return_transition(directory: &Path) {
    let database = Database::connect(format!("sqlite:{}", directory.join("state.db").display()))
        .await
        .unwrap();
    database
        .execute_unprepared(
            "INSERT INTO worktracker_issuetypetransition
        (issue_type_id, from_state_id, to_state_id, agent_allowed)
        VALUES ('30000000000000000000000000000002',
                '40000000000000000000000000000004',
                '40000000000000000000000000000003', 0)",
        )
        .await
        .unwrap();
    database.close().await.unwrap();
}
