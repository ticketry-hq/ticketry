//! Checked historical SQLite corrections.
//!
//! The catalog is generated from the recorded migration graph. Runtime picks
//! one entry by generation and exact schema fingerprint, executes only that
//! entry's ordered statements, and proves the canonical target fingerprint
//! before the transaction may commit.

use std::sync::OnceLock;

use sea_orm::{ConnectionTrait, DatabaseConnection, DatabaseTransaction};
use serde::Deserialize;

use super::error::{AdoptionFailure, Refusal};
use super::inventory;
use super::phase::Phase;
use crate::classification::schema_facts;

const ALEMBIC_GENERATION: &str = "alembic-0006_design_documents";

#[derive(Debug, Deserialize)]
pub struct Catalog {
    pub version: u32,
    pub generated_by: String,
    pub rust_leaf: String,
    pub statements: Vec<String>,
    pub bridges: Vec<Bridge>,
}

#[derive(Debug, Deserialize)]
pub struct Bridge {
    pub id: String,
    pub source_generation: String,
    pub source_fingerprints: Vec<String>,
    pub target_fingerprint: String,
    pub precondition: String,
    pub postcondition: String,
    pub statement_ids: Vec<usize>,
}

#[must_use]
pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("bridges.v1.json"))
            .expect("the checked SQLite bridge catalog must deserialize")
    })
}

pub fn select(generation: &str, fingerprint: &str) -> Result<&'static Bridge, AdoptionFailure> {
    let Some(bridge) = catalog()
        .bridges
        .iter()
        .find(|bridge| bridge.source_generation == generation)
    else {
        return Err(failed(
            Refusal::BridgeRequired,
            format!("no bridge is registered for historical generation {generation}"),
        ));
    };
    if !bridge
        .source_fingerprints
        .iter()
        .any(|accepted| accepted == fingerprint)
    {
        return Err(failed(
            Refusal::BridgePreconditionFailed,
            format!(
                "{} does not accept source fingerprint {fingerprint}",
                bridge.id
            ),
        ));
    }
    Ok(bridge)
}

pub async fn set_foreign_keys(
    database: &DatabaseConnection,
    enabled: bool,
) -> Result<(), AdoptionFailure> {
    database
        .execute_unprepared(if enabled {
            "PRAGMA foreign_keys = ON"
        } else {
            "PRAGMA foreign_keys = OFF"
        })
        .await
        .map_err(|error| {
            failed(
                Refusal::BridgePreconditionFailed,
                format!("could not set bridge foreign-key mode: {error}"),
            )
        })?;
    Ok(())
}

pub async fn apply(
    transaction: &DatabaseTransaction,
    ordered: &[&Bridge],
) -> Result<(), AdoptionFailure> {
    if ordered.len() != 1 {
        return Err(failed(
            Refusal::InvalidBridgeOrder,
            "historical SQLite adoption requires exactly one source-to-leaf bridge",
        ));
    }
    let bridge = ordered[0];
    if bridge.source_generation == ALEMBIC_GENERATION {
        let source = inventory::read(transaction).await.map_err(|error| {
            failed(
                Refusal::BridgePreconditionFailed,
                format!("{} could not check its precondition: {error}", bridge.id),
            )
        })?;
        if source.counts.values().any(|count| *count != 0) {
            return Err(failed(
                Refusal::BridgePreconditionFailed,
                format!(
                    "{} requires every pre-Django product table to be empty",
                    bridge.id
                ),
            ));
        }
    }
    for statement_id in &bridge.statement_ids {
        let statement = catalog().statements.get(*statement_id).ok_or_else(|| {
            failed(
                Refusal::InvalidBridgeOrder,
                format!("{} refers to unknown statement {statement_id}", bridge.id),
            )
        })?;
        transaction
            .execute_unprepared(statement)
            .await
            .map_err(|error| {
                failed(
                    Refusal::BridgePreconditionFailed,
                    format!(
                        "{} could not apply its recorded correction: {error}",
                        bridge.id
                    ),
                )
            })?;
    }
    let observed = schema_facts::read(transaction).await.map_err(|error| {
        failed(
            Refusal::BridgePostconditionFailed,
            format!("{} could not inspect its result: {error}", bridge.id),
        )
    })?;
    let fingerprint = schema_facts::fingerprint(&observed);
    if fingerprint != bridge.target_fingerprint {
        return Err(failed(
            Refusal::BridgePostconditionFailed,
            format!(
                "{} produced fingerprint {fingerprint}, expected {}",
                bridge.id, bridge.target_fingerprint
            ),
        ));
    }
    Ok(())
}

fn failed(refusal: Refusal, detail: impl Into<String>) -> AdoptionFailure {
    AdoptionFailure::new(Phase::BridgeWork, refusal, detail)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use sea_orm::{Database, TransactionTrait};

    use super::{apply, catalog, Bridge};
    use crate::adoption::Refusal;
    use crate::adoption::RUST_LEAF;
    use crate::classification::manifest;

    #[test]
    fn every_historical_fingerprint_has_one_stable_bridge() {
        let expected = manifest()
            .generations
            .iter()
            .filter(|generation| generation.expected == "bridge")
            .map(|generation| (&generation.name, &generation.fingerprint))
            .collect::<BTreeSet<_>>();
        let actual = catalog()
            .bridges
            .iter()
            .flat_map(|bridge| {
                bridge
                    .source_fingerprints
                    .iter()
                    .map(move |fingerprint| (&bridge.source_generation, fingerprint))
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(actual, expected);
        assert_eq!(catalog().version, 1);
        assert_eq!(catalog().rust_leaf, RUST_LEAF);
        assert_eq!(catalog().generated_by, "scripts/installation_corpus.py");
        assert!(catalog().bridges.iter().all(|bridge| {
            !bridge.id.is_empty()
                && !bridge.precondition.is_empty()
                && !bridge.postcondition.is_empty()
        }));
    }

    #[test]
    fn bridge_statement_sequences_are_closed_and_nonempty() {
        for bridge in &catalog().bridges {
            assert!(
                !bridge.statement_ids.is_empty(),
                "{} has no correction",
                bridge.id
            );
            assert!(bridge
                .statement_ids
                .iter()
                .all(|id| *id < catalog().statements.len()));
        }
    }

    #[tokio::test]
    async fn a_failed_postcondition_rolls_back_instead_of_guessing() {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("open a database");
        let transaction = database.begin().await.expect("start a transaction");
        let bridge = Bridge {
            id: "wrong-target.v1".to_owned(),
            source_generation: "test".to_owned(),
            source_fingerprints: vec!["source".to_owned()],
            target_fingerprint: "not-the-empty-schema".to_owned(),
            precondition: "exact source".to_owned(),
            postcondition: "exact target".to_owned(),
            statement_ids: Vec::new(),
        };
        let failure = apply(&transaction, &[&bridge])
            .await
            .expect_err("the wrong target must fail");
        assert_eq!(failure.refusal(), Refusal::BridgePostconditionFailed);
        transaction.rollback().await.expect("roll back");
    }

    #[tokio::test]
    async fn an_invalid_bridge_order_is_refused_before_a_statement_runs() {
        let database = Database::connect("sqlite::memory:")
            .await
            .expect("open a database");
        let transaction = database.begin().await.expect("start a transaction");
        let failure = apply(&transaction, &[])
            .await
            .expect_err("an empty bridge sequence must fail");
        assert_eq!(failure.refusal(), Refusal::InvalidBridgeOrder);
        transaction.rollback().await.expect("roll back");
    }
}
