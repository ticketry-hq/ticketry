//! Reviewed repairs for semantic defects in a Rust-owned installation.
//!
//! `design_documents` is a registry of filesystem metadata, but older document
//! deletion did not cascade when its module and task were removed. The normal
//! model mutation cannot repair that state because preflight keeps every public
//! write closed. SQLite foreign keys also cannot help because this historical
//! table has no declared relationship to WorkItem. The bridge below is the
//! smallest repair: delete only registry rows whose referenced module or task
//! no longer exists. It never deletes a file and it runs in the same transaction
//! as the updated adoption ledger. The installation-adoption fixture proves the
//! recovery snapshot, row scope, ledger record, and idempotent reopen.

use sea_orm::{ConnectionTrait, DatabaseTransaction, DbBackend, Statement};

use super::error::{AdoptionFailure, Refusal};
use super::inventory::{self, Inventory};
use super::phase::Phase;

pub(crate) const REMOVE_ORPHANED_DOCUMENT_METADATA: &str =
    "remove-orphaned-design-document-metadata.v1";

const ORPHAN_PREDICATE: &str = "NOT EXISTS (SELECT 1 FROM worktracker_issue module
                 WHERE module.id = design_documents.module_id)
     OR NOT EXISTS (SELECT 1 FROM worktracker_issue task
                    WHERE task.id = design_documents.task_id)";

pub(crate) async fn apply(
    transaction: &DatabaseTransaction,
    ordered: &[String],
) -> Result<Inventory, AdoptionFailure> {
    if ordered.len() != 1 || ordered[0] != REMOVE_ORPHANED_DOCUMENT_METADATA {
        return Err(failed(
            Refusal::InvalidBridgeOrder,
            format!(
                "unsupported semantic bridge sequence: {}",
                ordered.join(", ")
            ),
        ));
    }
    let before = orphan_count(transaction).await?;
    if before == 0 {
        return Err(failed(
            Refusal::BridgePreconditionFailed,
            format!("{REMOVE_ORPHANED_DOCUMENT_METADATA} found no orphaned metadata"),
        ));
    }
    let deleted = transaction
        .execute_unprepared(&format!(
            "DELETE FROM design_documents WHERE {ORPHAN_PREDICATE}"
        ))
        .await
        .map_err(|error| {
            failed(
                Refusal::BridgePreconditionFailed,
                format!(
                    "{REMOVE_ORPHANED_DOCUMENT_METADATA} could not remove orphaned metadata: {error}"
                ),
            )
        })?
        .rows_affected();
    if deleted != before || orphan_count(transaction).await? != 0 {
        return Err(failed(
            Refusal::BridgePostconditionFailed,
            format!(
                "{REMOVE_ORPHANED_DOCUMENT_METADATA} expected to remove {before} row(s), removed {deleted}"
            ),
        ));
    }
    inventory::read(transaction).await.map_err(|error| {
        failed(
            Refusal::BridgePostconditionFailed,
            format!("{REMOVE_ORPHANED_DOCUMENT_METADATA} could not inventory its result: {error}"),
        )
    })
}

async fn orphan_count<C: ConnectionTrait>(database: &C) -> Result<u64, AdoptionFailure> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT COUNT(*) AS count FROM design_documents WHERE {ORPHAN_PREDICATE}"
            ),
        ))
        .await
        .map_err(|error| {
            failed(
                Refusal::BridgePreconditionFailed,
                format!(
                    "{REMOVE_ORPHANED_DOCUMENT_METADATA} could not inspect its precondition: {error}"
                ),
            )
        })?
        .ok_or_else(|| {
            failed(
                Refusal::BridgePreconditionFailed,
                format!(
                    "{REMOVE_ORPHANED_DOCUMENT_METADATA} precondition returned no row"
                ),
            )
        })?;
    row.try_get::<i64>("", "count")
        .map(|count| count as u64)
        .map_err(|error| {
            failed(
                Refusal::BridgePreconditionFailed,
                format!("{REMOVE_ORPHANED_DOCUMENT_METADATA} returned an invalid count: {error}"),
            )
        })
}

fn failed(refusal: Refusal, detail: impl Into<String>) -> AdoptionFailure {
    AdoptionFailure::new(Phase::BridgeWork, refusal, detail)
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, TransactionTrait};

    use super::{apply, REMOVE_ORPHANED_DOCUMENT_METADATA};

    async fn database() -> sea_orm::DatabaseConnection {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("open a database");
        database
            .execute_unprepared(
                "CREATE TABLE worktracker_issue (id text PRIMARY KEY);
                 CREATE TABLE design_documents (
                    id text PRIMARY KEY, module_id text NOT NULL, task_id text NOT NULL
                 );
                 INSERT INTO worktracker_issue (id) VALUES ('module'), ('task');
                 INSERT INTO design_documents (id, module_id, task_id)
                    VALUES ('valid', 'module', 'task'),
                           ('orphan-module', 'missing', 'task'),
                           ('orphan-task', 'module', 'missing');",
            )
            .await
            .expect("create the bridge fixture");
        database
    }

    #[tokio::test]
    async fn the_bridge_deletes_only_metadata_with_a_missing_owner() {
        let database = database().await;
        let transaction = database.begin().await.expect("start the bridge");

        let inventory = apply(
            &transaction,
            &[REMOVE_ORPHANED_DOCUMENT_METADATA.to_owned()],
        )
        .await
        .expect("repair the fixture");

        assert_eq!(inventory.counts["design_documents"], 1);
        let remaining = transaction
            .query_one_raw(sea_orm::Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                "SELECT id FROM design_documents".to_owned(),
            ))
            .await
            .expect("read repaired rows")
            .expect("one row remains")
            .try_get::<String>("", "id")
            .expect("read the identity");
        assert_eq!(remaining, "valid");
        transaction.rollback().await.expect("roll back the fixture");
    }

    #[tokio::test]
    async fn an_unregistered_sequence_cannot_mutate_rows() {
        let database = database().await;
        let transaction = database.begin().await.expect("start the bridge");

        apply(&transaction, &["unknown.v1".to_owned()])
            .await
            .expect_err("an unregistered bridge must fail");

        let count = transaction
            .query_one_raw(sea_orm::Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                "SELECT COUNT(*) AS count FROM design_documents".to_owned(),
            ))
            .await
            .expect("count unchanged rows")
            .expect("the count returned")
            .try_get::<i64>("", "count")
            .expect("read the count");
        assert_eq!(count, 3);
        transaction.rollback().await.expect("roll back the fixture");
    }
}
