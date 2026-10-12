//! Reject malformed provider-catalog entries before anything is written.

use std::collections::HashSet;

use sea_orm::DbErr;
use ticketry_provider::Provider;

use super::catalog_registry::CatalogEntry;

/// Reject an entry the runner must never apply. The ledger name is
/// interpolated into SQL, so its pattern is a safety check, not only style.
pub(super) fn validate_entry(entry: &CatalogEntry) -> Result<(), DbErr> {
    let id = entry.migration_id;
    if id.is_empty() {
        return Err(invalid("<unnamed>", "empty migration id"));
    }
    if !is_ledger_name(entry.ledger) {
        return Err(invalid(
            id,
            &format!("invalid ledger table {:?}", entry.ledger),
        ));
    }
    if !is_sha(entry.source_commit) {
        return Err(invalid(
            id,
            &format!("invalid source commit {:?}", entry.source_commit),
        ));
    }
    if Provider::from_slug(entry.provider).is_none() {
        return Err(invalid(id, &format!("unknown provider {}", entry.provider)));
    }
    if entry.handler.is_some() && !entry.models.is_empty() {
        return Err(invalid(id, "named handler cannot also declare models"));
    }
    let mut models = HashSet::new();
    for model in entry.models {
        check_name(id, "model", model.name)?;
        if !models.insert(model.name) {
            return Err(invalid(id, &format!("duplicate model {}", model.name)));
        }
        let mut levels = HashSet::new();
        for level in model.reasoning {
            check_name(id, "reasoning", level)?;
            if !levels.insert(*level) {
                return Err(invalid(
                    id,
                    &format!("duplicate reasoning {level} for {}", model.name),
                ));
            }
        }
    }
    Ok(())
}

/// Reject a registry whose identities collide or whose steps are out of order.
pub(super) fn validate_registry(entries: &[&CatalogEntry]) -> Result<(), DbErr> {
    let mut ids = HashSet::new();
    let mut ledgers = HashSet::new();
    let mut steps = HashSet::new();
    let mut previous: Option<u32> = None;
    for entry in entries {
        validate_entry(entry)?;
        let id = entry.migration_id;
        if !ids.insert(id) {
            return Err(invalid(id, "duplicate migration id"));
        }
        if !ledgers.insert(entry.ledger) {
            return Err(invalid(
                id,
                &format!("duplicate ledger table {}", entry.ledger),
            ));
        }
        if !steps.insert(entry.step) {
            return Err(invalid(id, &format!("duplicate step {}", entry.step)));
        }
        if let Some(previous) = previous.filter(|previous| entry.step <= *previous) {
            return Err(invalid(
                id,
                &format!("step {} does not follow step {previous}", entry.step),
            ));
        }
        previous = Some(entry.step);
    }
    Ok(())
}

fn check_name(id: &str, kind: &str, name: &str) -> Result<(), DbErr> {
    if name.trim().is_empty() {
        return Err(invalid(id, &format!("blank {kind} name")));
    }
    if name.trim() != name {
        return Err(invalid(id, &format!("untrimmed {kind} name {name:?}")));
    }
    Ok(())
}

/// `ticketry_<snake>_catalog_migration`, with a non-empty lowercase snake body.
fn is_ledger_name(name: &str) -> bool {
    let Some(body) = name
        .strip_prefix("ticketry_")
        .and_then(|rest| rest.strip_suffix("_catalog_migration"))
    else {
        return false;
    };
    !body.is_empty()
        && !body.starts_with('_')
        && !body.ends_with('_')
        && body
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn is_sha(commit: &str) -> bool {
    commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn invalid(id: &str, reason: &str) -> DbErr {
    DbErr::Custom(format!("invalid provider catalog migration {id}: {reason}"))
}

#[cfg(test)]
mod tests;
