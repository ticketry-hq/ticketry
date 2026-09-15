//! Ordered data migrations for the provider catalog.

mod codex_5_6;
mod codex_6_astra;
mod codex_glm_5_3_flash;
mod codex_spark;
mod ledger;

use sea_orm::{DatabaseConnection, DbErr, TransactionTrait};

pub const CODEX_5_6_LEDGER: &str = "ticketry_codex_5_6_catalog_migration";
pub const CODEX_5_6_MIGRATION_ID: &str = "0044_codex_5_6_model_catalog";
pub const CODEX_SPARK_LEDGER: &str = "ticketry_codex_spark_catalog_migration";
pub const CODEX_SPARK_MIGRATION_ID: &str = "0051_codex_5_3_model_catalog";
pub const CODEX_ASTRA_LEDGER: &str = "ticketry_codex_astra_catalog_migration";
pub const CODEX_ASTRA_MIGRATION_ID: &str = "0054_codex_5_6_astra_model_catalog";
pub const CODEX_6_ASTRA_LEDGER: &str = "ticketry_codex_6_astra_catalog_migration";
pub const CODEX_6_ASTRA_MIGRATION_ID: &str = "0055_codex_6_astra_model_rename";
pub const CODEX_GLM_5_3_FLASH_LEDGER: &str = "ticketry_codex_glm_5_3_flash_catalog_migration";
pub const CODEX_GLM_5_3_FLASH_MIGRATION_ID: &str = "0057_codex_glm_5_3_flash_model_catalog";
pub const VERSION: i32 = 1;

const SOURCE_0044: &str = "3a5f434a90696f40a4911e401a84db009cdfa4e7";
const SOURCE_0051: &str = "602596a1ea0146a1d19aad20912bdd9d3b2f1dfe";
const SOURCE_0054: &str = "d3f16cf4110343cfbcacdf1804086eb17fc3aa18";
const SOURCE_0055: &str = "d129f28d7472cb11fd91cbd9ba3fa7738690397c";
const SOURCE_0057: &str = "ad89c36920f99d13abc67364f432d61237987b4c";

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

pub async fn install_codex_astra(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, CODEX_ASTRA_LEDGER).await? {
        ledger::verify(
            &transaction,
            CODEX_ASTRA_LEDGER,
            CODEX_ASTRA_MIGRATION_ID,
            SOURCE_0054,
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

    codex_5_6::apply_astra(&transaction).await?;
    ledger::write(
        &transaction,
        CODEX_ASTRA_LEDGER,
        CODEX_ASTRA_MIGRATION_ID,
        SOURCE_0054,
    )
    .await?;
    transaction.commit().await
}

pub async fn install_codex_6_astra(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, CODEX_6_ASTRA_LEDGER).await? {
        ledger::verify(
            &transaction,
            CODEX_6_ASTRA_LEDGER,
            CODEX_6_ASTRA_MIGRATION_ID,
            SOURCE_0055,
        )
        .await?;
        transaction.commit().await?;
        return Ok(());
    }
    if !ledger::all_tables_exist(
        &transaction,
        &["worktracker_provider", "worktracker_agentmodel"],
    )
    .await?
    {
        transaction.commit().await?;
        return Ok(());
    }

    codex_6_astra::apply(&transaction).await?;
    ledger::write(
        &transaction,
        CODEX_6_ASTRA_LEDGER,
        CODEX_6_ASTRA_MIGRATION_ID,
        SOURCE_0055,
    )
    .await?;
    transaction.commit().await
}

pub async fn install_codex_glm_5_3_flash(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, CODEX_GLM_5_3_FLASH_LEDGER).await? {
        ledger::verify(
            &transaction,
            CODEX_GLM_5_3_FLASH_LEDGER,
            CODEX_GLM_5_3_FLASH_MIGRATION_ID,
            SOURCE_0057,
        )
        .await?;
        transaction.commit().await?;
        return Ok(());
    }
    if !ledger::all_tables_exist(
        &transaction,
        &["worktracker_provider", "worktracker_agentmodel"],
    )
    .await?
    {
        transaction.commit().await?;
        return Ok(());
    }

    codex_glm_5_3_flash::apply(&transaction).await?;
    ledger::write(
        &transaction,
        CODEX_GLM_5_3_FLASH_LEDGER,
        CODEX_GLM_5_3_FLASH_MIGRATION_ID,
        SOURCE_0057,
    )
    .await?;
    transaction.commit().await
}
