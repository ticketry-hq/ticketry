use super::REGISTRY;

/// Identities copied from the handwritten 0061 and 0062 migrations; existing
/// installations verify their ledgers against these bytes.
#[test]
fn codex_6_identities_are_unchanged() {
    let identities = REGISTRY
        .iter()
        .filter(|entry| entry.step >= 61)
        .map(|entry| {
            (
                entry.step,
                entry.migration_id,
                entry.ledger,
                entry.source_commit,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        identities,
        [
            (
                61,
                "0061_codex_6_sol_luna_model_catalog",
                "ticketry_codex_6_sol_luna_catalog_migration",
                "e83759b16eadbc706e5773fe2d52b880b4a61112",
            ),
            (
                62,
                "0062_codex_6_1_sol_model_catalog",
                "ticketry_codex_6_1_sol_catalog_migration",
                "d34566a9cc3d343d521781df6e07c65dab585a88",
            ),
        ]
    );
}

#[test]
fn codex_6_content_is_unchanged() {
    let content = REGISTRY
        .iter()
        .filter(|entry| entry.step >= 61)
        .map(|entry| {
            let models = entry
                .models
                .iter()
                .map(|model| (model.name, model.reasoning))
                .collect::<Vec<_>>();
            (entry.provider, entry.missing_provider, models)
        })
        .collect::<Vec<_>>();
    let none_to_max: &[&str] = &["none", "low", "medium", "high", "xhigh", "max"];
    let low_to_ultra: &[&str] = &["low", "medium", "high", "xhigh", "max", "ultra"];
    assert_eq!(
        content,
        [
            (
                "codex",
                super::MissingProvider::Fail,
                vec![("gpt-6-sol", none_to_max), ("gpt-6-luna", none_to_max)],
            ),
            (
                "codex",
                super::MissingProvider::Fail,
                vec![("gpt-6.1-sol", low_to_ultra)]
            ),
        ]
    );
}

#[test]
fn all_historical_catalog_identities_are_unchanged() {
    let identities = REGISTRY
        .iter()
        .map(|entry| {
            (
                entry.step,
                entry.migration_id,
                entry.ledger,
                entry.source_commit,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        identities,
        vec![
            (
                44,
                "0044_codex_5_6_model_catalog",
                "ticketry_codex_5_6_catalog_migration",
                "3a5f434a90696f40a4911e401a84db009cdfa4e7"
            ),
            (
                51,
                "0051_codex_5_3_model_catalog",
                "ticketry_codex_spark_catalog_migration",
                "602596a1ea0146a1d19aad20912bdd9d3b2f1dfe"
            ),
            (
                54,
                "0054_codex_5_6_astra_model_catalog",
                "ticketry_codex_astra_catalog_migration",
                "d3f16cf4110343cfbcacdf1804086eb17fc3aa18"
            ),
            (
                55,
                "0055_codex_6_astra_model_rename",
                "ticketry_codex_6_astra_catalog_migration",
                "d129f28d7472cb11fd91cbd9ba3fa7738690397c"
            ),
            (
                57,
                "0057_codex_glm_5_3_flash_model_catalog",
                "ticketry_codex_glm_5_3_flash_catalog_migration",
                "ad89c36920f99d13abc67364f432d61237987b4c"
            ),
            (
                61,
                "0061_codex_6_sol_luna_model_catalog",
                "ticketry_codex_6_sol_luna_catalog_migration",
                "e83759b16eadbc706e5773fe2d52b880b4a61112"
            ),
            (
                62,
                "0062_codex_6_1_sol_model_catalog",
                "ticketry_codex_6_1_sol_catalog_migration",
                "d34566a9cc3d343d521781df6e07c65dab585a88"
            ),
        ]
    );
    assert_eq!(super::super::VERSION, 1);
}
