//! Decide whether a structurally valid installation is safe to adopt.
//!
//! Classification answers "which installation is this". Preflight answers the
//! next question: "is what it contains something Ticketry can carry forward".
//! Those are different questions, and a database can pass the first and fail
//! the second — a recognized current schema whose rows still hold a parent
//! cycle, a blocker loop, a state outside its own workflow, a tmux name that
//! would address a pane instead of a session, or a document path that leaves
//! its root.
//!
//! Adoption preserves whatever it finds. So anything meaningless in the source
//! stays meaningless afterwards, except that Ticketry is then acting on it — and
//! the step that would fix it is the one step of the migration that cannot be
//! undone. Preflight therefore runs before it, reads only, and refuses.
//!
//! Three properties hold by construction:
//!
//! * **One consistent view.** Every check reads through a single read-only
//!   transaction, so the report describes one committed state rather than a
//!   state no version of the installation ever had.
//! * **No effect of any kind.** Nothing is written, created, launched, cleaned
//!   up, or contacted. tmux is not run, Git is not run, no provider is started,
//!   no event is published. A refusal leaves the source byte-for-byte reusable.
//! * **No implicit repair.** A defect is reported, never fixed. Only a named,
//!   versioned bridge in [`bridges`] may admit one; an unknown defect refuses.

pub mod bridges;
pub mod capability_invariants;
pub mod error;
pub mod filesystem;
pub mod invariant;
pub mod path_authority;
pub mod read_view;
pub mod report;
pub mod runtime;
pub mod runtime_names;
pub mod schema;
pub mod seaography_override;
pub mod structural;
pub mod work_management_invariants;

use std::path::Path;

pub use error::{PreflightError, PreflightFailure};
pub use report::{Area, Defect, PreflightReport, Skipped, Verdict};

use crate::installation_classification::Installation;
use invariant::Findings;
use read_view::ReadView;
use schema::Schema;

/// Run the read-only semantic preflight for a classified installation.
///
/// `classified` comes from
/// [`crate::installation_classification::classify`]. Preflight does not
/// reclassify: the schema decision belongs to one place, and running it twice
/// invites two answers.
///
/// # Errors
///
/// Returns a [`PreflightError`] when preflight cannot look at all — an
/// unreadable installation, an engine whose checks need a driver this binary
/// does not carry, or a classification with nothing to inspect. A defect is not
/// an error: it appears in the returned report, and the caller refuses on it.
pub async fn preflight(
    data_directory: &Path,
    classified: &Installation,
) -> Result<PreflightReport, PreflightError> {
    match classified {
        Installation::Empty => Ok(nothing_to_check(classified)),
        Installation::PostgresImportSource(_) => Err(PreflightError::new(
            PreflightFailure::EngineNotInspectable,
            "a PostgreSQL source is preflighted through the import's own consistent \
             snapshot, which carries the driver these checks need",
        )),
        Installation::SqliteCurrent(_) | Installation::SqliteHistorical(_) => {
            sqlite(data_directory, classified).await
        }
        Installation::RustOwned(_) => sqlite(data_directory, classified).await,
    }
}

/// Preflight a SQLite installation through one consistent read view.
async fn sqlite(
    data_directory: &Path,
    classified: &Installation,
) -> Result<PreflightReport, PreflightError> {
    let view = ReadView::open(data_directory).await?;
    let outcome = inspect(&view, data_directory, classified).await;
    view.close().await;
    outcome
}

async fn inspect(
    view: &ReadView,
    data_directory: &Path,
    classified: &Installation,
) -> Result<PreflightReport, PreflightError> {
    let reader = view.reader();
    let schema = Schema::read(reader).await?;
    let mut findings = Findings::default();

    // Integrity first. Every semantic rule below trusts the rows it reads, and
    // on a damaged file that trust is misplaced — a clean semantic report over
    // a corrupt database is the most dangerous answer preflight could give.
    structural::check(reader, &mut findings).await?;

    for list in [
        work_management_invariants::invariants(),
        capability_invariants::invariants(),
    ] {
        invariant::run(reader, &schema, &list, &mut findings)
            .await
            .map_err(|error| {
                PreflightError::new(
                    PreflightFailure::UnreadableInstallation,
                    format!("a semantic check could not run: {error}"),
                )
            })?;
    }

    filesystem::check(reader, &schema, data_directory, &mut findings).await?;
    runtime::check(reader, &schema, &mut findings).await?;

    let mut defects = findings.defects;
    defects.sort_by(|left, right| {
        (left.area, &left.code)
            .partial_cmp(&(right.area, &right.code))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    bridges::admit(&mut defects, classified.generation(), bridges::REGISTRY);
    findings
        .skipped
        .sort_by(|left, right| left.code.cmp(&right.code));

    Ok(PreflightReport {
        engine: classified.engine(),
        generation: classified.generation().to_owned(),
        checked: findings.checked,
        skipped: findings.skipped,
        defects,
    })
}

/// An empty installation has no rows, so every rule is vacuously satisfied.
///
/// It is reported as a completed run with nothing checked rather than as an
/// error, so the caller's decision path is the same for a first launch as for
/// an existing installation.
fn nothing_to_check(classified: &Installation) -> PreflightReport {
    PreflightReport {
        engine: classified.engine(),
        generation: classified.generation().to_owned(),
        checked: 0,
        skipped: Vec::new(),
        defects: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{capability_invariants, work_management_invariants};

    #[test]
    fn no_rule_name_is_used_in_two_lists() {
        let mut names = work_management_invariants::invariants()
            .into_iter()
            .chain(capability_invariants::invariants())
            .map(|invariant| invariant.code)
            .collect::<Vec<_>>();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(
            names.len(),
            total,
            "two rules share a name across the lists"
        );
    }

    #[test]
    fn every_migrated_capability_is_covered_by_at_least_one_rule() {
        // The tables named here are the ones earlier slices moved into Rust
        // ownership. A capability with no rule would be adopted unchecked, so
        // the omission is named here rather than discovered after a cutover.
        let queries = work_management_invariants::invariants()
            .into_iter()
            .chain(capability_invariants::invariants())
            .map(|invariant| invariant.query)
            .collect::<Vec<_>>()
            .join("\n");
        for table in [
            "worktracker_workspace",
            "worktracker_project",
            "worktracker_issue",
            "worktracker_issuetype",
            "worktracker_state",
            "worktracker_issuetypetransition",
            "worktracker_launchbinding",
            "worktracker_issue_blocked_by",
            "worktracker_attachment",
            "worktracker_agentmodel",
            "app_settings",
            "agent_runs",
            "automation_attempts",
            "runs_status_events",
            "runs_project_compaction_watermarks",
            "design_documents",
            "worktrees",
            "graph_runs",
            "launched_tasks",
            "launch_policy_effects",
            "agent_terminal_sessions",
            "agent_run_viewer_leases",
            "terminal_launch_requests",
            "runs_launch_effects",
            "terminal_cleanup_effects",
            "workspace_operations",
            "module_links",
        ] {
            assert!(
                queries.contains(table),
                "{table} is adopted but no rule checks it"
            );
        }
    }
}
