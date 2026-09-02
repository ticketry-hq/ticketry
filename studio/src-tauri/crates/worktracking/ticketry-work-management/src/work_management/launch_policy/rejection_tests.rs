//! A rejection must stay a diagnosis: readable by callers, and — when the
//! reason is a configuration the user can repair — never terminal.

use sea_orm::{ColumnTrait, Set};
use sea_orm::{
    ConnectionTrait, Database, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
};

use super::rejections;
use super::LaunchPolicyError;
use crate::work_management::open_for_commands;
use ticketry_entities::{launch_policy_rejection, transition_occurrence};

const WORK_ITEM: &str = "50000000000000000000000000000001";
const STATE: &str = "40000000000000000000000000000002";

async fn fixture() -> (tempfile::TempDir, DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared("PRAGMA journal_mode=WAL;")
        .await
        .unwrap();
    drop(writer);
    let database = open_for_commands(&path).await.unwrap();
    (directory, database)
}

async fn seed_occurrence(database: &DatabaseConnection, occurrence_id: &str) {
    transition_occurrence::Entity::insert(transition_occurrence::ActiveModel {
        occurrence_id: Set(occurrence_id.to_owned()),
        version: Set(1),
        issue_id: Set(WORK_ITEM.to_owned()),
        project_id: Set("10000000000000000000000000000000".to_owned()),
        issue_type_id: Set("30000000000000000000000000000002".to_owned()),
        from_state_id: Set("40000000000000000000000000000001".to_owned()),
        to_state_id: Set(STATE.to_owned()),
        from_group: Set("backlog".to_owned()),
        to_group: Set("started".to_owned()),
        work_item_revision: Set(1),
        workflow_revision: Set(1),
        destination_auto_start: Set(true),
        handoff: Set(false),
        run_now_decision_id: Set(None),
        committed_at: sea_orm::NotSet,
    })
    .exec_without_returning(database)
    .await
    .unwrap();
}

async fn rejection(database: &DatabaseConnection, key: &str) -> launch_policy_rejection::Model {
    launch_policy_rejection::Entity::find()
        .filter(launch_policy_rejection::Column::IdempotencyKey.eq(key))
        .one(database)
        .await
        .unwrap()
        .expect("rejection row")
}

fn error(code: &'static str, message: &str) -> LaunchPolicyError {
    LaunchPolicyError::rejected(code, message.to_owned())
}

/// Every configuration state a sibling capability can leave behind must be
/// classified recoverable, or fixing it would not re-queue the auto-start.
#[test]
fn recoverable_codes_cover_repairable_configuration() {
    for code in [
        "provider_not_activated",
        "module_folder_unusable",
        "module_not_found",
        "unsupported_model",
        "unsupported_reasoning",
    ] {
        assert!(rejections::is_recoverable(code), "{code} must be retryable");
    }
    assert!(!rejections::is_recoverable("task_not_found"));
}

#[tokio::test]
async fn repeating_a_rejection_replaces_the_stored_diagnosis() {
    let (_directory, database) = fixture().await;
    rejections::record(
        &database,
        "auto_start",
        "occurrence-1",
        &error(
            "provider_not_activated",
            "Provider 'claude' is not activated.",
        ),
    )
    .await
    .unwrap();
    rejections::record(
        &database,
        "auto_start",
        "occurrence-1",
        &error("module_folder_unusable", "The Module has no linked folder."),
    )
    .await
    .unwrap();

    let row = rejection(&database, "occurrence-1").await;
    assert_eq!(row.code, "module_folder_unusable");
    assert_eq!(row.message, "The Module has no linked folder.");
    assert_eq!(
        launch_policy_rejection::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn resolving_an_occurrence_clears_its_rejection() {
    let (_directory, database) = fixture().await;
    rejections::record(
        &database,
        "auto_start",
        "occurrence-1",
        &error("module_not_found", "No module ancestry."),
    )
    .await
    .unwrap();
    rejections::clear(&database, "auto_start", "occurrence-1")
        .await
        .unwrap();
    assert_eq!(
        launch_policy_rejection::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        0
    );
}

/// A rejection just written is inside the backoff window; one written before it
/// is eligible again. Terminal codes never become eligible.
#[tokio::test]
async fn only_aged_recoverable_rejections_are_retried() {
    let (_directory, database) = fixture().await;
    rejections::record(
        &database,
        "auto_start",
        "fresh",
        &error("provider_not_activated", "Provider is not activated."),
    )
    .await
    .unwrap();
    rejections::record(
        &database,
        "auto_start",
        "aged",
        &error("provider_not_activated", "Provider is not activated."),
    )
    .await
    .unwrap();
    rejections::record(
        &database,
        "auto_start",
        "gone",
        &error("task_not_found", "Task not found."),
    )
    .await
    .unwrap();
    age(&database, "aged").await;
    age(&database, "gone").await;

    let keys = rejections::retryable_keys(&database, "auto_start", 16)
        .await
        .unwrap();
    assert_eq!(keys, vec!["aged".to_owned()]);
}

/// The diagnosis is addressable from the work item it blocks.
#[tokio::test]
async fn the_ledger_reads_back_against_the_work_item() {
    let (_directory, database) = fixture().await;
    seed_occurrence(&database, "occurrence-1").await;
    rejections::record(
        &database,
        "auto_start",
        "occurrence-1",
        &error(
            "provider_not_activated",
            "Provider 'claude' is not activated.",
        ),
    )
    .await
    .unwrap();

    let rows = rejections::for_work_item(&database, WORK_ITEM)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].code, "provider_not_activated");
    assert_eq!(rows[0].message, "Provider 'claude' is not activated.");
    assert!(rows[0].recoverable);
    assert_eq!(rows[0].occurrence_id, "occurrence-1");
    assert_eq!(
        rows[0].destination_state_id,
        "40000000-0000-0000-0000-000000000002"
    );
    assert_eq!(rows[0].work_item_id, "50000000-0000-0000-0000-000000000001");

    assert!(
        rejections::for_work_item(&database, "60000000000000000000000000000009")
            .await
            .unwrap()
            .is_empty()
    );
}

async fn age(database: &DatabaseConnection, key: &str) {
    database
        .execute_unprepared(&format!(
            "UPDATE ticketry_launchpolicyrejection
             SET rejected_at = datetime('now', '-1 hour')
             WHERE idempotency_key = '{key}'"
        ))
        .await
        .unwrap();
}
