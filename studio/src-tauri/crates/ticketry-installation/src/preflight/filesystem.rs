//! Authorize every path the installation recorded, and the roots it owns.
//!
//! The rules themselves live in [`super::path_authority`]; this module is what
//! reads the rows and the data directory and reports what those rules say. The
//! split matters because the rules are pure and heavily tested while this part
//! must touch the filesystem, and it does so read-only: it stats paths and
//! never creates, opens, moves, or removes one.
//!
//! No path text ever reaches the report. An offending row is reported by its
//! own identity plus a digest of the path, so two offending paths stay
//! distinguishable and neither is disclosed.

use sea_orm::{ConnectionTrait, DbBackend, Statement};
use std::path::Path;

use super::error::{PreflightError, PreflightFailure};
use super::invariant::Findings;
use super::path_authority::{self, Owned, PathDefect};
use super::report::{path_identity, Area, REPORTED_IDENTITIES};
use super::schema::Schema;

/// One column of recorded paths and the authority it is judged against.
struct PathColumn {
    /// The table holding the paths.
    table: &'static str,
    /// The column holding them.
    column: &'static str,
    /// A stable identity for the row, as a SQL expression.
    identity: &'static str,
    /// Whether the column records an external root or a contained relative path.
    kind: Recorded,
}

/// What a recorded path claims to be.
#[derive(Clone, Copy, Eq, PartialEq)]
enum Recorded {
    /// An absolute directory outside the data directory: a repository, a
    /// checkout, a design directory, a launch working directory.
    ExternalRoot,
    /// A path recorded relative to a root it must not leave.
    ContainedRelative,
}

/// Every path column preflight authorizes, with its authority.
const PATH_COLUMNS: &[PathColumn] = &[
    PathColumn {
        table: "design_documents",
        column: "root_dir",
        identity: "id",
        kind: Recorded::ExternalRoot,
    },
    PathColumn {
        table: "design_documents",
        column: "rel_path",
        identity: "id",
        kind: Recorded::ContainedRelative,
    },
    PathColumn {
        table: "worktrees",
        column: "repo_root",
        identity: "id",
        kind: Recorded::ExternalRoot,
    },
    PathColumn {
        table: "worktrees",
        column: "path",
        identity: "id",
        kind: Recorded::ExternalRoot,
    },
    PathColumn {
        table: "agent_runs",
        column: "cwd",
        identity: "id",
        kind: Recorded::ExternalRoot,
    },
    PathColumn {
        table: "agent_runs",
        column: "design_dir",
        identity: "id",
        kind: Recorded::ExternalRoot,
    },
    PathColumn {
        table: "agent_terminal_sessions",
        column: "doc_rel_path",
        identity: "agent_run_id",
        kind: Recorded::ContainedRelative,
    },
    PathColumn {
        table: "terminal_launch_requests",
        column: "working_directory",
        identity: "effect_id",
        kind: Recorded::ExternalRoot,
    },
    PathColumn {
        table: "terminal_launch_requests",
        column: "doc_rel_path",
        identity: "effect_id",
        kind: Recorded::ContainedRelative,
    },
    PathColumn {
        table: "worktracker_attachment",
        column: "file",
        identity: "id",
        kind: Recorded::ContainedRelative,
    },
    PathColumn {
        table: "module_links",
        column: "path",
        identity: "id",
        kind: Recorded::ExternalRoot,
    },
];

/// The entries inside the data directory Ticketry itself owns.
const OWNED_ENTRIES: &[(&str, Owned)] = &[
    ("media", Owned::Directory),
    ("worktrees", Owned::Directory),
    ("profiles.json", Owned::File),
    ("features.json", Owned::File),
    (
        ticketry_work_management::module_links::receipt::RECEIPT_FILE,
        Owned::File,
    ),
    ("sidecar.log", Owned::File),
];

/// Authorize every recorded path and every root the data directory owns.
///
/// # Errors
///
/// Returns [`PreflightFailure::UnreadableInstallation`] when a path column
/// cannot be read.
pub async fn check<C: ConnectionTrait>(
    view: &C,
    schema: &Schema,
    data_directory: &Path,
    findings: &mut Findings,
) -> Result<(), PreflightError> {
    let mut offences: Vec<(PathDefect, String)> = Vec::new();
    for column in PATH_COLUMNS {
        if !schema.satisfies(&format!("{}.{}", column.table, column.column)) {
            findings.skipped.push(super::report::Skipped {
                code: format!("path:{}.{}", column.table, column.column),
                missing_requirement: format!("{}.{}", column.table, column.column),
            });
            continue;
        }
        findings.checked += 1;
        for (identity, recorded) in read_column(view, column).await? {
            let defect = match column.kind {
                Recorded::ExternalRoot => path_authority::external_root(&recorded),
                Recorded::ContainedRelative => path_authority::contained_relative(&recorded),
            };
            if let Some(defect) = defect {
                offences.push((defect, format!("{identity}@{}", path_identity(&recorded))));
            }
        }
    }

    findings.checked += 1;
    for (name, expected) in OWNED_ENTRIES {
        let candidate = data_directory.join(name);
        if let Some(defect) = path_authority::owned_path(data_directory, &candidate, *expected) {
            offences.push((defect, format!("data-directory/{name}")));
        }
    }

    findings.checked += 1;
    let spool = ticketry_runs::hook_spool::hook_spool_directory(data_directory);
    // The spool root deliberately lives beside the temporary directory rather
    // than inside the data directory, so its allowed root is that parent. A
    // missing spool is normal: nothing has launched a provider yet.
    if let Some(parent) = spool.parent() {
        if let Some(defect) = path_authority::owned_path(parent, &spool, Owned::Directory) {
            offences.push((defect, "hook-spool".to_owned()));
        }
    }

    report(offences, findings);
    Ok(())
}

/// Group offences by rule, so one broken rule is one defect with a count.
fn report(mut offences: Vec<(PathDefect, String)>, findings: &mut Findings) {
    offences.sort_by(|left, right| left.1.cmp(&right.1));
    for defect in [
        PathDefect::Malformed,
        PathDefect::UnexpectedlyAbsolute,
        PathDefect::UnexpectedlyRelative,
        PathDefect::EscapesRoot,
        PathDefect::SymlinkEscapesRoot,
        PathDefect::WrongKind,
    ] {
        let affected = offences
            .iter()
            .filter(|(found, _)| *found == defect)
            .map(|(_, identity)| identity.clone())
            .collect::<Vec<_>>();
        findings.record(
            defect.code(),
            Area::Filesystem,
            defect.rule(),
            affected.iter().take(REPORTED_IDENTITIES).cloned().collect(),
            affected.len() as u64,
        );
    }
}

/// Read one path column, skipping the rows that recorded nothing.
async fn read_column<C: ConnectionTrait>(
    view: &C,
    column: &PathColumn,
) -> Result<Vec<(String, String)>, PreflightError> {
    let query = format!(
        "SELECT CAST({identity} AS TEXT) AS identity, {column} AS recorded
         FROM {table} WHERE {column} IS NOT NULL",
        identity = column.identity,
        column = column.column,
        table = column.table,
    );
    let rows = view
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
        .await
        .map_err(|error| {
            PreflightError::new(
                PreflightFailure::UnreadableInstallation,
                format!(
                    "could not read the recorded paths in {}.{}: {error}",
                    column.table, column.column
                ),
            )
        })?;
    let mut recorded = Vec::with_capacity(rows.len());
    for row in rows {
        let identity = row.try_get::<String>("", "identity").map_err(|error| {
            PreflightError::new(
                PreflightFailure::UnreadableInstallation,
                format!("could not read a path row identity: {error}"),
            )
        })?;
        // A non-text value in a path column is not a path. It is reported as
        // malformed through the empty string rather than failing the whole run.
        let value = row
            .try_get::<Option<String>>("", "recorded")
            .unwrap_or_default()
            .unwrap_or_default();
        recorded.push((identity, value));
    }
    Ok(recorded)
}
