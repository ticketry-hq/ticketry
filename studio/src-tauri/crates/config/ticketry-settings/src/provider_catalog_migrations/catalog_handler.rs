//! Named internal operations for catalog changes that cannot reconcile rows.

use sea_orm::{DatabaseTransaction, DbErr};

use super::codex_6_astra;

#[derive(Clone, Copy, Debug)]
pub(super) enum CatalogHandler {
    RenameAstra,
}

impl CatalogHandler {
    pub(super) fn required_tables(self) -> &'static [&'static str] {
        match self {
            Self::RenameAstra => codex_6_astra::REQUIRED_TABLES,
        }
    }

    pub(super) async fn apply(
        self,
        transaction: &DatabaseTransaction,
        provider_id: &str,
    ) -> Result<(), DbErr> {
        match self {
            Self::RenameAstra => codex_6_astra::apply(transaction, provider_id).await,
        }
    }
}
