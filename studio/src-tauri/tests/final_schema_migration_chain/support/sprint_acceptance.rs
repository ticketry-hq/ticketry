//! Sprint invariants shared by fresh-install and upgrade acceptance tests.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

const SPRINTS: &str = "0063_sprints";
/// The migration identity that historically precedes sprints.
const PREVIOUS: &str = "0062_codex_6_1_sol_model_catalog";
/// Historical migrations installed before sprints.
const SPRINT_POSITION: usize = 18;

/// Sprints keep their historical place; later catalog steps may follow them.
pub fn assert_sprint_history(ids: &[&str]) {
    let positions: Vec<_> = ids
        .iter()
        .enumerate()
        .filter_map(|(index, id)| (*id == SPRINTS).then_some(index))
        .collect();
    assert_eq!(
        positions,
        [SPRINT_POSITION],
        "{SPRINTS} must appear once at its historical position"
    );
    assert_eq!(
        ids[SPRINT_POSITION - 1],
        PREVIOUS,
        "{SPRINTS} must directly follow {PREVIOUS}"
    );
}

pub async fn assert_sprint_schema_and_ledger(database: &DatabaseConnection) {
    for table in [
        "worktracker_sprint",
        "worktracker_sprint_goal",
        "worktracker_sprint_suggestion",
        "agent_executions",
    ] {
        assert!(
            super::table_exists(database, table).await,
            "missing {table}"
        );
    }
    let columns = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_issue)".to_owned(),
        ))
        .await
        .unwrap();
    assert!(columns.iter().any(|column| {
        column.try_get::<String>("", "name").unwrap() == "sprint_id"
            && column.try_get::<i64>("", "notnull").unwrap() == 0
    }));
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT version, migration_id FROM ticketry_sprint_migration".to_owned(),
        ))
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].try_get::<i64>("", "version").unwrap(), 1);
    assert_eq!(
        rows[0].try_get::<String>("", "migration_id").unwrap(),
        SPRINTS
    );
}
