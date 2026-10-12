//! The ordered, declarative provider-catalog migrations the runner applies.

use std::sync::OnceLock;

use sea_orm::DbErr;

use super::catalog_handler::CatalogHandler;
use super::catalog_validation::validate_registry;

/// What the runner does when an entry's provider row is absent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MissingProvider {
    /// Fail the step, rolling back its transaction.
    Fail,
    /// Apply nothing but still record the ledger.
    Skip,
}

/// One model and the reasoning levels it supports, in order.
#[derive(Debug)]
pub(super) struct CatalogModel {
    pub(super) name: &'static str,
    pub(super) reasoning: &'static [&'static str],
}

/// One versioned provider-catalog migration.
#[derive(Debug)]
pub(super) struct CatalogEntry {
    pub(super) migration_id: &'static str,
    pub(super) ledger: &'static str,
    pub(super) source_commit: &'static str,
    pub(super) step: u32,
    pub(super) provider: &'static str,
    pub(super) missing_provider: MissingProvider,
    pub(super) models: &'static [CatalogModel],
    pub(super) handler: Option<CatalogHandler>,
}

/// The registry, validated once, so a bad entry fails every catalog install.
pub(super) fn validated() -> Result<&'static [&'static CatalogEntry], DbErr> {
    static VALIDATION: OnceLock<Result<(), String>> = OnceLock::new();
    VALIDATION
        .get_or_init(|| validate_registry(REGISTRY).map_err(|error| error.to_string()))
        .clone()
        .map(|()| REGISTRY)
        .map_err(DbErr::Custom)
}

/// Every declarative catalog migration, in chain order.
pub(super) const REGISTRY: &[&CatalogEntry] = &[
    &CODEX_5_6,
    &CODEX_SPARK,
    &CODEX_ASTRA,
    &CODEX_6_ASTRA,
    &CODEX_GLM_5_3_FLASH,
    &CODEX_6_SOL_LUNA,
    &CODEX_6_1_SOL,
];

pub(super) const CODEX_5_6: CatalogEntry = CatalogEntry {
    migration_id: "0044_codex_5_6_model_catalog",
    ledger: "ticketry_codex_5_6_catalog_migration",
    source_commit: "3a5f434a90696f40a4911e401a84db009cdfa4e7",
    step: 44,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[
        CatalogModel {
            name: "gpt-5.6-sol",
            reasoning: &["low", "medium", "high", "xhigh", "max", "ultra"],
        },
        CatalogModel {
            name: "gpt-5.6-terra",
            reasoning: &["low", "medium", "high", "xhigh", "max", "ultra"],
        },
        CatalogModel {
            name: "gpt-5.6-luna",
            reasoning: &["low", "medium", "high", "xhigh", "max"],
        },
    ],
};

pub(super) const CODEX_SPARK: CatalogEntry = CatalogEntry {
    migration_id: "0051_codex_5_3_model_catalog",
    ledger: "ticketry_codex_spark_catalog_migration",
    source_commit: "602596a1ea0146a1d19aad20912bdd9d3b2f1dfe",
    step: 51,
    provider: "codex",
    missing_provider: MissingProvider::Skip,
    handler: None,
    models: &[CatalogModel {
        name: "gpt-5.3-codex-spark",
        reasoning: &[],
    }],
};

pub(super) const CODEX_ASTRA: CatalogEntry = CatalogEntry {
    migration_id: "0054_codex_5_6_astra_model_catalog",
    ledger: "ticketry_codex_astra_catalog_migration",
    source_commit: "d3f16cf4110343cfbcacdf1804086eb17fc3aa18",
    step: 54,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[CatalogModel {
        name: "gpt-5.6-astra",
        reasoning: &["low", "medium", "high", "xhigh", "max", "ultra"],
    }],
};

pub(super) const CODEX_6_ASTRA: CatalogEntry = CatalogEntry {
    migration_id: "0055_codex_6_astra_model_rename",
    ledger: "ticketry_codex_6_astra_catalog_migration",
    source_commit: "d129f28d7472cb11fd91cbd9ba3fa7738690397c",
    step: 55,
    provider: "codex",
    missing_provider: MissingProvider::Skip,
    handler: Some(CatalogHandler::RenameAstra),
    models: &[],
};

/// Unlike the historical wrapper, the runner also requires the reasoning-join
/// table that reconciliation deletes from, deferring incomplete schemas safely.
pub(super) const CODEX_GLM_5_3_FLASH: CatalogEntry = CatalogEntry {
    migration_id: "0057_codex_glm_5_3_flash_model_catalog",
    ledger: "ticketry_codex_glm_5_3_flash_catalog_migration",
    source_commit: "ad89c36920f99d13abc67364f432d61237987b4c",
    step: 57,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[CatalogModel {
        name: "glm-5.3-flash",
        reasoning: &[],
    }],
};

/// Reasoning levels advertised by the Codex model catalog for GPT-6 Sol and Luna.
pub(super) const CODEX_6_SOL_LUNA: CatalogEntry = CatalogEntry {
    migration_id: "0061_codex_6_sol_luna_model_catalog",
    ledger: "ticketry_codex_6_sol_luna_catalog_migration",
    source_commit: "e83759b16eadbc706e5773fe2d52b880b4a61112",
    step: 61,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[
        CatalogModel {
            name: "gpt-6-sol",
            reasoning: &["none", "low", "medium", "high", "xhigh", "max"],
        },
        CatalogModel {
            name: "gpt-6-luna",
            reasoning: &["none", "low", "medium", "high", "xhigh", "max"],
        },
    ],
};

/// GPT-6.1 Sol with the reasoning levels advertised by the Codex model catalog.
pub(super) const CODEX_6_1_SOL: CatalogEntry = CatalogEntry {
    migration_id: "0062_codex_6_1_sol_model_catalog",
    ledger: "ticketry_codex_6_1_sol_catalog_migration",
    source_commit: "d34566a9cc3d343d521781df6e07c65dab585a88",
    step: 62,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[CatalogModel {
        name: "gpt-6.1-sol",
        reasoning: &["low", "medium", "high", "xhigh", "max", "ultra"],
    }],
};

#[cfg(test)]
mod tests;
