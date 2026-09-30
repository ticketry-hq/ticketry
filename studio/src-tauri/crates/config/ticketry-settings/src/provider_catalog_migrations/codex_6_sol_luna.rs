use sea_orm::{ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, TransactionTrait};

use ticketry_entities::provider;

use super::{codex_5_6::apply_model, ledger};

pub const CODEX_6_SOL_LUNA_LEDGER: &str = "ticketry_codex_6_sol_luna_catalog_migration";
pub const CODEX_6_SOL_LUNA_MIGRATION_ID: &str = "0061_codex_6_sol_luna_model_catalog";
const SOURCE: &str = "e83759b16eadbc706e5773fe2d52b880b4a61112";
const REASONING: &[&str] = &["none", "low", "medium", "high", "xhigh", "max"];

pub async fn install_codex_6_sol_luna(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if ledger::exists(&transaction, CODEX_6_SOL_LUNA_LEDGER).await? {
        ledger::verify(
            &transaction,
            CODEX_6_SOL_LUNA_LEDGER,
            CODEX_6_SOL_LUNA_MIGRATION_ID,
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
    for model in ["gpt-6-sol", "gpt-6-luna"] {
        apply_model(&transaction, &codex.id, model, REASONING).await?;
    }
    ledger::write(
        &transaction,
        CODEX_6_SOL_LUNA_LEDGER,
        CODEX_6_SOL_LUNA_MIGRATION_ID,
        SOURCE,
    )
    .await?;
    transaction.commit().await
}
