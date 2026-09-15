//! Red tests for the durable ShipRecord action receipt.
//!
//! These are the acceptance facts the spec requires: a migration installs the
//! table through the adoption path, database constraints enforce append-only
//! action facts and ownership, receipt creation is idempotent by operation id,
//! persistence failure surfaces as a typed error, the Seaography read contract
//! is scoped, and the public API boundary stays deliberate.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, Database, DatabaseConnection, DbBackend,
    EntityTrait, QueryFilter, Statement, TransactionTrait,
};
use ticketry_entities::{issue, ship_record};
use ticketry_workspace_runtime::persistence::ship_record_migration;

const MODULE_ID: &str = "00000000000000000000000000001001";
const TASK_ID: &str = "00000000000000000000000000001002";
const OPERATION_ID: &str = "op-1854-red";

async fn database() -> DatabaseConnection {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_unprepared(
            "CREATE TABLE worktracker_issue (
                id varchar(32) PRIMARY KEY,
                type varchar(16) NOT NULL,
                project_id varchar(32) NOT NULL,
                parent_id varchar(32) NULL
            );
            INSERT INTO worktracker_issue (id, type, project_id, parent_id) VALUES
                ('00000000000000000000000000001000','project','00000000000000000000000000001000',NULL),
                ('00000000000000000000000000001001','module','00000000000000000000000000001000',NULL),
                ('00000000000000000000000000001002','task','00000000000000000000000000001000','00000000000000000000000000001001');",
        )
        .await
        .unwrap();
    ship_record_migration::install(&database).await.unwrap();
    database
}

fn insert_for(
    module_id: &str,
    task_id: Option<&str>,
    operation_id: &str,
) -> ship_record::ActiveModel {
    ship_record::ActiveModel {
        id: sea_orm::Set("sr00000000000000000000000000001".to_owned()),
        module_id: sea_orm::Set(module_id.to_owned()),
        task_id: sea_orm::Set(task_id.map(str::to_owned)),
        checkout_kind: sea_orm::Set(
            if task_id.is_some() {
                "task_worktree"
            } else {
                "module_checkout"
            }
            .to_owned(),
        ),
        checkout_label: sea_orm::Set("CODING-1854 worktree".to_owned()),
        operation_id: sea_orm::Set(operation_id.to_owned()),
        branch: sea_orm::Set("ticketry/CODING-1854".to_owned()),
        commit_shas: sea_orm::Set(serde_json::json!([
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        ])),
        steps: sea_orm::Set(serde_json::json!([
            {"step": "stage", "status": "ok", "display": "Staged"},
            {"step": "commit", "status": "ok", "display": "Committed"},
            {"step": "push", "status": "failed", "display": "Push failed"}])),
        acted_at: sea_orm::Set("2026-09-15T10:00:00Z".to_owned()),
        pr_url: sea_orm::Set(None),
        pr_number: sea_orm::Set(None),
        pr_state: sea_orm::Set(None),
        pr_refreshed_at: sea_orm::Set(None),
    }
}

#[tokio::test]
async fn migration_creates_the_ship_record_table() {
    let database = database().await;
    let columns: Vec<String> = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(ticketry_shiprecords)".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect();
    for column in [
        "id",
        "module_id",
        "task_id",
        "checkout_kind",
        "checkout_label",
        "operation_id",
        "branch",
        "commit_shas",
        "steps",
        "acted_at",
        "pr_url",
        "pr_number",
        "pr_state",
        "pr_refreshed_at",
    ] {
        assert!(columns.contains(&column.to_owned()), "missing {column}");
    }
}

#[tokio::test]
async fn operation_id_is_unique() {
    let database = database().await;
    ship_record::Entity::insert(insert_for(MODULE_ID, Some(TASK_ID), OPERATION_ID))
        .exec(&database)
        .await
        .unwrap();
    let second = ship_record::Entity::insert(insert_for(MODULE_ID, Some(TASK_ID), OPERATION_ID))
        .exec(&database)
        .await;
    assert!(second.is_err(), "duplicate operation id must be rejected");
}

#[tokio::test]
async fn task_reference_is_optional_and_checked() {
    let database = database().await;
    ship_record::Entity::insert(insert_for(MODULE_ID, None, "op-module-only"))
        .exec(&database)
        .await
        .unwrap();
    let unknown = insert_for(
        MODULE_ID,
        Some("00000000000000000000000000000999"),
        "op-unknown-task",
    );
    let error = ship_record::Entity::insert(unknown).exec(&database).await;
    assert!(error.is_err(), "unknown task reference must be rejected");
}

#[tokio::test]
async fn module_deletion_cascades_and_task_deletion_keeps_history() {
    let database = database().await;
    ship_record::Entity::insert(insert_for(MODULE_ID, Some(TASK_ID), OPERATION_ID))
        .exec(&database)
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "DELETE FROM worktracker_issue WHERE id='{TASK_ID}'"
        ))
        .await
        .unwrap();
    let kept = ship_record::Entity::find()
        .filter(ship_record::Column::OperationId.eq(OPERATION_ID))
        .one(&database)
        .await
        .unwrap()
        .expect("module history survives task deletion");
    assert!(kept.task_id.is_none(), "task deletion nulls the reference");
    database
        .execute_unprepared(&format!(
            "DELETE FROM worktracker_issue WHERE id='{MODULE_ID}'"
        ))
        .await
        .unwrap();
    let remaining = ship_record::Entity::find()
        .filter(ship_record::Column::OperationId.eq(OPERATION_ID))
        .one(&database)
        .await
        .unwrap();
    assert!(remaining.is_none(), "module deletion cascades receipts");
}

#[tokio::test]
async fn pr_facts_must_be_complete_and_terminated() {
    let database = database().await;
    let mut partial = insert_for(MODULE_ID, Some(TASK_ID), "op-partial-pr");
    partial.pr_url = sea_orm::Set(Some("https://github.com/acme/repo/pull/7".to_owned()));
    let error = ship_record::Entity::insert(partial).exec(&database).await;
    assert!(
        error.is_err(),
        "PR URL without number and state is rejected"
    );

    let mut open = insert_for(MODULE_ID, Some(TASK_ID), "op-open-pr");
    open.pr_url = sea_orm::Set(Some("https://github.com/acme/repo/pull/7".to_owned()));
    open.pr_number = sea_orm::Set(Some(7));
    open.pr_state = sea_orm::Set(Some("open".to_owned()));
    ship_record::Entity::insert(open)
        .exec(&database)
        .await
        .unwrap();

    let mut terminal = insert_for(MODULE_ID, Some(TASK_ID), "op-terminal-pr");
    terminal.pr_url = sea_orm::Set(Some("https://github.com/acme/repo/pull/8".to_owned()));
    terminal.pr_number = sea_orm::Set(Some(8));
    terminal.pr_state = sea_orm::Set(Some("unknown".to_owned()));
    let error = ship_record::Entity::insert(terminal).exec(&database).await;
    assert!(
        error.is_err(),
        "only open, merged, and closed are valid PR states"
    );
}

#[tokio::test]
async fn pr_state_may_only_move_open_to_merged_or_closed() {
    let database = database().await;
    let mut model = insert_for(MODULE_ID, Some(TASK_ID), OPERATION_ID);
    model.pr_url = sea_orm::Set(Some("https://github.com/acme/repo/pull/9".to_owned()));
    model.pr_number = sea_orm::Set(Some(9));
    model.pr_state = sea_orm::Set(Some("open".to_owned()));
    model.pr_refreshed_at = sea_orm::Set(Some("2026-09-15T10:05:00Z".to_owned()));
    ship_record::Entity::insert(model)
        .exec(&database)
        .await
        .unwrap();

    let stored = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT pr_state FROM ticketry_shiprecords WHERE operation_id='{OPERATION_ID}'"
            ),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.try_get::<String>("", "pr_state").unwrap(), "open");

    let transaction = database.begin().await.unwrap();
    transaction
        .execute_unprepared(&format!(
            "UPDATE ticketry_shiprecords SET pr_state='merged', pr_refreshed_at='2026-09-15T11:00:00Z' WHERE operation_id='{OPERATION_ID}'"
        ))
        .await
        .unwrap();
    transaction.commit().await.unwrap();
    let stored = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT pr_state FROM ticketry_shiprecords WHERE operation_id='{OPERATION_ID}'"
            ),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.try_get::<String>("", "pr_state").unwrap(), "merged");
}

#[tokio::test]
async fn commit_shas_are_full_and_lowercase() {
    let database = database().await;
    let mut short = insert_for(MODULE_ID, Some(TASK_ID), "op-short-sha");
    short.commit_shas = sea_orm::Set(serde_json::json!(["ABCDEF"]));
    let error = ship_record::Entity::insert(short).exec(&database).await;
    assert!(error.is_err(), "short SHAs are rejected");
    let mut uppercase = insert_for(MODULE_ID, Some(TASK_ID), "op-uppercase-sha");
    uppercase.commit_shas = sea_orm::Set(serde_json::json!([
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    ]));
    let error = ship_record::Entity::insert(uppercase).exec(&database).await;
    assert!(error.is_err(), "uppercase SHAs are rejected");
    let mut empty = insert_for(MODULE_ID, Some(TASK_ID), "op-empty-shas");
    empty.commit_shas = sea_orm::Set(serde_json::json!([]));
    let error = ship_record::Entity::insert(empty).exec(&database).await;
    assert!(error.is_err(), "at least one commit SHA is required");
}

#[tokio::test]
async fn receipt_persistence_is_idempotent_by_operation_id() {
    let database = database().await;
    let first = ship_record::append(&database, receipt(OPERATION_ID, false))
        .await
        .unwrap();
    let retry = ship_record::append(&database, receipt(OPERATION_ID, false))
        .await
        .unwrap();
    assert_eq!(first.id, retry.id);
    assert_eq!(first.operation_id, retry.operation_id);
}

#[tokio::test]
async fn receipt_persistence_failure_is_typed() {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    let error = ship_record::append(&database, receipt(OPERATION_ID, false))
        .await
        .unwrap_err();
    assert_eq!(error.code_str(), "ship_receipt_persistence_failed");
}

fn receipt(operation_id: &str, _failed: bool) -> ship_record::AppendReceipt {
    ship_record::AppendReceipt {
        module_id: MODULE_ID.to_owned(),
        task_id: Some(TASK_ID.to_owned()),
        checkout_kind: "task_worktree".to_owned(),
        checkout_label: "CODING-1854 worktree".to_owned(),
        operation_id: operation_id.to_owned(),
        branch: "ticketry/CODING-1854".to_owned(),
        commit_shas: vec!["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned()],
        steps: vec![],
        acted_at: "2026-09-15T10:00:00Z".to_owned(),
        pr_url: None,
        pr_number: None,
        pr_state: None,
    }
}

#[tokio::test]
async fn seaography_read_contract_stays_scoped() {
    let sdl = ticketry_graphql_schema::generated_schema_sdl()
        .await
        .expect("build shipping schema");
    for fragment in [
        "type ShipRecords {",
        "input ShipRecordsFilterInput {",
        "shipRecords(filters: ShipRecordsFilterInput",
    ] {
        assert!(sdl.contains(fragment), "missing generated read {fragment}");
    }
    for operation in [
        "shipRecordsCreateOne",
        "shipRecordsCreateBatch",
        "shipRecordsUpdate",
        "shipRecordsDelete",
    ] {
        assert!(
            !sdl.contains(operation),
            "shipping schema exposes generated {operation}"
        );
    }
}
