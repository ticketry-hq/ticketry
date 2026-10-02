//! Add GPT-6.1 Sol with the reasoning levels advertised by the Codex model catalog.

use sea_orm::{ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, TransactionTrait};

use ticketry_entities::provider;

use super::{codex_5_6::apply_model, ledger};

pub const CODEX_6_1_SOL_LEDGER: &str = "ticketry_codex_6_1_sol_catalog_migration";
pub const CODEX_6_1_SOL_MIGRATION_ID: &str = "0062_codex_6_1_sol_model_catalog";
const SOURCE: &str = "d34566a9cc3d343d521781df6e07c65dab585a88";
const REASONING: &[&str] = &["low", "medium", "high", "xhigh", "max", "ultra"];

pub async fn install_codex_6_1_sol(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, CODEX_6_1_SOL_LEDGER).await? {
        ledger::verify(
            &transaction,
            CODEX_6_1_SOL_LEDGER,
            CODEX_6_1_SOL_MIGRATION_ID,
            SOURCE,
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

    let codex = provider::Entity::find()
        .filter(provider::Column::Slug.eq("codex"))
        .one(&transaction)
        .await?
        .ok_or_else(|| DbErr::Custom("the provider catalog has no codex provider".to_owned()))?;
    apply_model(&transaction, &codex.id, "gpt-6.1-sol", REASONING).await?;
    ledger::write(
        &transaction,
        CODEX_6_1_SOL_LEDGER,
        CODEX_6_1_SOL_MIGRATION_ID,
        SOURCE,
    )
    .await?;
    transaction.commit().await
}
