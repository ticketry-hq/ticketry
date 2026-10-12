use super::validate_registry;
use crate::provider_catalog_migrations::catalog_registry::{
    validated, CatalogEntry, CatalogModel, MissingProvider, REGISTRY,
};

const FIRST: CatalogEntry = CatalogEntry {
    migration_id: "0098_codex_first_model_catalog",
    ledger: "ticketry_codex_first_catalog_migration",
    source_commit: "0123456789abcdef0123456789abcdef01234567",
    step: 98,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[CatalogModel {
        name: "gpt-first",
        reasoning: &["low"],
    }],
};
const SECOND: CatalogEntry = CatalogEntry {
    migration_id: "0099_codex_second_model_catalog",
    ledger: "ticketry_codex_second_catalog_migration",
    step: 99,
    ..FIRST
};

fn rejection(entries: &[&CatalogEntry]) -> String {
    validate_registry(entries)
        .expect_err("registry should be rejected")
        .to_string()
}

#[test]
fn the_shipped_registry_is_valid() {
    validate_registry(REGISTRY).unwrap();
    assert_eq!(validated().unwrap().len(), REGISTRY.len());
}

#[test]
fn distinct_increasing_entries_are_valid() {
    validate_registry(&[&FIRST, &SECOND]).unwrap();
}

#[test]
fn a_duplicate_migration_id_is_rejected() {
    let twin = CatalogEntry {
        migration_id: FIRST.migration_id,
        ..SECOND
    };
    assert!(rejection(&[&FIRST, &twin]).contains("duplicate migration id"));
}

#[test]
fn a_duplicate_ledger_table_is_rejected() {
    let twin = CatalogEntry {
        ledger: FIRST.ledger,
        ..SECOND
    };
    assert!(rejection(&[&FIRST, &twin]).contains("duplicate ledger table"));
}

#[test]
fn a_duplicate_step_number_is_rejected() {
    let twin = CatalogEntry { step: 98, ..SECOND };
    assert!(rejection(&[&FIRST, &twin]).contains("duplicate step 98"));
}

#[test]
fn step_numbers_that_do_not_strictly_increase_are_rejected() {
    assert!(rejection(&[&SECOND, &FIRST]).contains("step 98 does not follow step 99"));
}

#[test]
fn an_invalid_entry_invalidates_the_registry() {
    let blank = CatalogEntry {
        migration_id: "",
        ..SECOND
    };
    assert!(rejection(&[&FIRST, &blank]).contains("empty migration id"));
}
