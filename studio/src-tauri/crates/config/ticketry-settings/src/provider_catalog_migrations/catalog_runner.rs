//! Apply one provider-catalog entry in a single transaction.

use sea_orm::{ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, TransactionTrait};

use ticketry_entities::provider;

use super::catalog_registry::{CatalogEntry, MissingProvider};
use super::catalog_validation::validate_entry;
use super::{catalog_reconciliation::apply_model, ledger};

pub(super) async fn run(database: &DatabaseConnection, entry: &CatalogEntry) -> Result<(), DbErr> {
    validate_entry(entry)?;
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, entry.ledger).await? {
        ledger::verify(
            &transaction,
            entry.ledger,
            entry.migration_id,
            entry.source_commit,
        )
        .await?;
        return transaction.commit().await;
    }
    if !ledger::all_tables_exist(&transaction, &required_tables(entry)).await? {
        return transaction.commit().await;
    }

    let target = provider::Entity::find()
        .filter(provider::Column::Slug.eq(entry.provider))
        .one(&transaction)
        .await?;
    match (target, entry.missing_provider) {
        (Some(target), _) => {
            if let Some(handler) = entry.handler {
                handler.apply(&transaction, &target.id).await?;
            }
            for model in entry.models {
                apply_model(&transaction, &target.id, model.name, model.reasoning).await?;
            }
        }
        (None, MissingProvider::Skip) => {}
        (None, MissingProvider::Fail) => {
            return Err(DbErr::Custom(format!(
                "the provider catalog has no {} provider",
                entry.provider
            )));
        }
    }
    ledger::write(
        &transaction,
        entry.ledger,
        entry.migration_id,
        entry.source_commit,
    )
    .await?;
    transaction.commit().await
}

/// The tables an entry's content touches; reasoning levels only when listed.
fn required_tables(entry: &CatalogEntry) -> Vec<&'static str> {
    if let Some(handler) = entry.handler {
        return handler.required_tables().to_vec();
    }
    let mut tables = vec![
        "worktracker_provider",
        "worktracker_agentmodel",
        "worktracker_agentmodelreasoninglevel",
    ];
    if entry.models.iter().any(|model| !model.reasoning.is_empty()) {
        tables.push("worktracker_reasoninglevel");
    }
    tables
}

#[cfg(test)]
mod tests;
