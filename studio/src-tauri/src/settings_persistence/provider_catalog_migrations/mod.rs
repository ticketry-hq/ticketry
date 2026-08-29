//! Ordered data migrations for the provider catalog.

mod codex_5_6;
mod codex_spark;
mod ledger;

use sea_orm::{DatabaseConnection, DbErr, TransactionTrait};

pub const CODEX_5_6_LEDGER: &str = "ticketry_codex_5_6_catalog_migration";
pub const CODEX_5_6_MIGRATION_ID: &str = "0044_codex_5_6_model_catalog";
pub const CODEX_SPARK_LEDGER: &str = "ticketry_codex_spark_catalog_migration";
pub const CODEX_SPARK_MIGRATION_ID: &str = "0051_codex_5_3_model_catalog";
pub const VERSION: i32 = 1;

const SOURCE_0044: &str = "3a5f434a90696f40a4911e401a84db009cdfa4e7";
const SOURCE_0051: &str = "602596a1ea0146a1d19aad20912bdd9d3b2f1dfe";

pub async fn install_codex_5_6(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, CODEX_5_6_LEDGER).await? {
        ledger::verify(
            &transaction,
            CODEX_5_6_LEDGER,
            CODEX_5_6_MIGRATION_ID,
            SOURCE_0044,
        )
        .await?;
        transaction.commit().await?;
        return Ok(());
    }
    if !ledger::all_tables_exist(
        &transaction,
        &[
            "worktracker_provider",
            "worktracker_agentmodel",
            "worktracker_reasoninglevel",
            "worktracker_agentmodelreasoninglevel",
        ],
    )
    .await?
    {
        transaction.commit().await?;
        return Ok(());
    }

    codex_5_6::apply(&transaction).await?;
    ledger::write(
        &transaction,
        CODEX_5_6_LEDGER,
        CODEX_5_6_MIGRATION_ID,
        SOURCE_0044,
    )
    .await?;
    transaction.commit().await
}

pub async fn install_codex_spark(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, CODEX_SPARK_LEDGER).await? {
        ledger::verify(
            &transaction,
            CODEX_SPARK_LEDGER,
            CODEX_SPARK_MIGRATION_ID,
            SOURCE_0051,
        )
        .await?;
        transaction.commit().await?;
        return Ok(());
    }
    if !ledger::all_tables_exist(
        &transaction,
        &[
            "worktracker_provider",
            "worktracker_agentmodel",
            "worktracker_agentmodelreasoninglevel",
        ],
    )
    .await?
    {
        transaction.commit().await?;
        return Ok(());
    }

    codex_spark::apply(&transaction).await?;
    ledger::write(
        &transaction,
        CODEX_SPARK_LEDGER,
        CODEX_SPARK_MIGRATION_ID,
        SOURCE_0051,
    )
    .await?;
    transaction.commit().await
}
