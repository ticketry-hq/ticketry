//! The storage-level checks every copy of the installation must pass.
//!
//! Preflight runs these against the source before adoption. They run again
//! against the recovery snapshot and against the adopted database, because the
//! question is different each time: first "is this database sound", then "did
//! the copy arrive intact", then "did the adoption leave it sound". The same
//! two pragmas answer all three.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

/// Refuse a database SQLite itself reports as damaged.
pub async fn structural(database: &DatabaseConnection) -> Result<(), String> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA integrity_check".to_owned(),
        ))
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "the integrity check returned no result".to_owned())?;
    let result = row
        .try_get_by_index::<String>(0)
        .map_err(|error| error.to_string())?;
    if result != "ok" {
        // SQLite's messages quote index keys, which are installation content.
        // Only the structural phrase is carried forward.
        let phrase = result.lines().next().unwrap_or("damaged");
        let redacted = phrase.split(':').next().unwrap_or("damaged");
        return Err(format!(
            "SQLite reports the database as damaged: {redacted}"
        ));
    }
    let violations = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned(),
        ))
        .await
        .map_err(|error| error.to_string())?;
    if !violations.is_empty() {
        return Err(format!(
            "{} declared foreign-key violation(s)",
            violations.len()
        ));
    }
    Ok(())
}
