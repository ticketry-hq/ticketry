//! The storage-level checks that must pass before any semantic rule means
//! anything.
//!
//! A semantic rule reads rows and trusts what it reads. On a database with a
//! corrupt page or a broken index that trust is misplaced: a query can miss
//! rows that exist, and a clean semantic report on a corrupt file is the most
//! dangerous output preflight could produce. So integrity comes first, and its
//! findings are reported as defects of their own.
//!
//! Both checks are read-only. `integrity_check` verifies pages, indexes, and
//! declared constraints; `foreign_key_check` verifies every declared foreign
//! key across the whole database, which SQLite does not enforce at write time
//! unless `foreign_keys` was on for the writing connection — and Ticketry's
//! Django era did not always guarantee that.

use sea_orm::{ConnectionTrait, DbBackend, Statement};

use super::error::{PreflightError, PreflightFailure};
use super::invariant::Findings;
use super::report::{Area, REPORTED_IDENTITIES};

/// How many `integrity_check` findings are asked for before it stops.
///
/// The check reports one row per problem and can enumerate a very large number
/// on a badly damaged file. A bounded run answers the only question preflight
/// asks — is this file sound — without reading a damaged database to its end.
const INTEGRITY_LIMIT: usize = 100;

/// Run SQLite's own integrity and foreign-key checks against the read view.
///
/// # Errors
///
/// Returns [`PreflightFailure::UnreadableInstallation`] when a check cannot
/// run. A check that runs and reports problems is a defect, not an error.
pub async fn check<C: ConnectionTrait>(
    view: &C,
    findings: &mut Findings,
) -> Result<(), PreflightError> {
    findings.checked += 1;
    let problems = integrity_problems(view).await?;
    findings.record(
        "sqlite-integrity",
        Area::Structure,
        "the database file must pass SQLite's own page, index, and constraint checks",
        problems
            .iter()
            .take(REPORTED_IDENTITIES)
            .map(|problem| problem_identity(problem))
            .collect(),
        problems.len() as u64,
    );

    findings.checked += 1;
    let violations = foreign_key_violations(view).await?;
    let total = violations.len() as u64;
    findings.record(
        "foreign-key-violation",
        Area::Structure,
        "every declared foreign key must resolve to an existing row",
        violations.into_iter().take(REPORTED_IDENTITIES).collect(),
        total,
    );
    Ok(())
}

/// The problems `integrity_check` reports, empty when the file is sound.
async fn integrity_problems<C: ConnectionTrait>(view: &C) -> Result<Vec<String>, PreflightError> {
    let rows = query(view, &format!("PRAGMA integrity_check({INTEGRITY_LIMIT})")).await?;
    let mut problems = Vec::new();
    for row in rows {
        let message = row
            .try_get::<String>("", "integrity_check")
            .map_err(|error| unreadable(format!("could not read the integrity check: {error}")))?;
        if message != "ok" {
            problems.push(message);
        }
    }
    Ok(problems)
}

/// Every foreign-key violation, as `table:rowid -> parent` identities.
async fn foreign_key_violations<C: ConnectionTrait>(
    view: &C,
) -> Result<Vec<String>, PreflightError> {
    let rows = query(view, "PRAGMA foreign_key_check").await?;
    let mut violations = Vec::new();
    for row in rows {
        // `rowid` is null for a WITHOUT ROWID table, so the row is identified by
        // its table and parent alone in that case. Both spellings are stable.
        let table = row
            .try_get::<String>("", "table")
            .map_err(|error| unreadable(format!("could not read a foreign-key row: {error}")))?;
        let parent = row
            .try_get::<String>("", "parent")
            .map_err(|error| unreadable(format!("could not read a foreign-key row: {error}")))?;
        let rowid = row.try_get::<Option<i64>>("", "rowid").unwrap_or(None);
        violations.push(match rowid {
            Some(rowid) => format!("{table}#{rowid}->{parent}"),
            None => format!("{table}->{parent}"),
        });
    }
    violations.sort();
    violations.dedup();
    Ok(violations)
}

/// The reported stand-in for one integrity message.
///
/// An `integrity_check` message can quote index keys, which are user content.
/// Only its leading structural phrase is kept, so the report says what kind of
/// damage was found without reproducing the damaged values.
fn problem_identity(message: &str) -> String {
    let structural = message
        .split_whitespace()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");
    structural
        .chars()
        .filter(|character| !character.is_ascii_control())
        .collect()
}

async fn query<C: ConnectionTrait>(
    view: &C,
    statement: &str,
) -> Result<Vec<sea_orm::QueryResult>, PreflightError> {
    view.query_all_raw(Statement::from_string(
        DbBackend::Sqlite,
        statement.to_owned(),
    ))
    .await
    .map_err(|error| unreadable(format!("{statement} could not run: {error}")))
}

fn unreadable(detail: String) -> PreflightError {
    PreflightError::new(PreflightFailure::UnreadableInstallation, detail)
}

#[cfg(test)]
mod tests {
    use super::problem_identity;

    #[test]
    fn an_integrity_message_keeps_its_shape_and_drops_the_keys() {
        assert_eq!(
            problem_identity(
                "row 42 missing from index idx_secret_client_name key='Acme Holdings'"
            ),
            "row 42 missing from"
        );
    }
}
