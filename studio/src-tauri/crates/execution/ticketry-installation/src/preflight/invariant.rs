//! One rule, expressed as the query that finds the rows breaking it.
//!
//! Almost every semantic invariant Ticketry needs before adoption is "these
//! rows should not exist". Writing each one as a query rather than as bespoke
//! Rust keeps the rules readable as a list, keeps them uniform in how they
//! report, and keeps the runner small enough to reason about once.
//!
//! A rule names the tables it needs. Historical generations do not carry every
//! table, so a rule whose table is absent is recorded as not applicable rather
//! than silently passing.

use sea_orm::{ConnectionTrait, DbBackend, Statement};

use super::report::{Area, Defect, Skipped, REPORTED_IDENTITIES};
use super::schema::Schema;

/// One semantic rule and the query that finds its violations.
pub(crate) struct Invariant {
    /// The stable machine-readable rule name, reported as-is.
    pub code: &'static str,
    /// Which capability the rule belongs to.
    pub area: Area,
    /// The rule in one operator-safe sentence.
    pub rule: &'static str,
    /// What the query needs, as `table` or `table.column` requirements.
    ///
    /// Supported generations differ in both tables and columns, so a rule that
    /// names its requirements is reported as not applicable to a generation
    /// that predates them rather than failing to run against it.
    pub requires: &'static [&'static str],
    /// A query selecting one `identity` column per offending row.
    ///
    /// The column must be a stable identifier — a primary key or a composite of
    /// keys. It must never be content: no name, path, prompt, command, or
    /// configuration value may be selected into it.
    ///
    /// It is owned rather than borrowed so a rule can compose the reviewed
    /// vocabulary of scopes and states into its text once instead of restating
    /// it, which is what keeps the lists from drifting apart.
    pub query: String,
}

/// What running the invariant list produced.
#[derive(Default)]
pub(crate) struct Findings {
    /// Rules that applied and ran.
    pub checked: usize,
    /// Rules this installation has no table for.
    pub skipped: Vec<Skipped>,
    /// Rules that found offending rows.
    pub defects: Vec<Defect>,
}

impl Findings {
    /// Record one defect found outside the query list.
    pub fn record(
        &mut self,
        code: &str,
        area: Area,
        rule: &str,
        identities: Vec<String>,
        total: u64,
    ) {
        if total == 0 {
            return;
        }
        let truncated = identities.len() < usize::try_from(total).unwrap_or(usize::MAX);
        self.defects.push(Defect {
            code: code.to_owned(),
            area,
            rule: rule.to_owned(),
            count: total,
            affected: identities,
            truncated,
            admitted_by: None,
        });
    }
}

/// Run every applicable invariant against one read view.
///
/// # Errors
///
/// Returns the underlying database error when a query cannot run at all. A
/// query that runs and finds rows is a defect, not an error.
pub(crate) async fn run<C: ConnectionTrait>(
    view: &C,
    schema: &Schema,
    invariants: &[Invariant],
    findings: &mut Findings,
) -> Result<(), sea_orm::DbErr> {
    for invariant in invariants {
        if let Some(absent) = invariant
            .requires
            .iter()
            .find(|requirement| !schema.satisfies(requirement))
        {
            findings.skipped.push(Skipped {
                code: invariant.code.to_owned(),
                missing_requirement: (*absent).to_owned(),
            });
            continue;
        }
        findings.checked += 1;
        let identities = offending_identities(view, &invariant.query).await?;
        findings.record(
            invariant.code,
            invariant.area,
            invariant.rule,
            identities
                .iter()
                .take(REPORTED_IDENTITIES)
                .cloned()
                .collect(),
            identities.len() as u64,
        );
    }
    Ok(())
}

/// Every offending identity a rule's query returns, sorted and deduplicated.
///
/// Sorting here rather than in each query keeps the rule list free of ordering
/// noise and makes a report byte-identical across runs, which is what lets a
/// user compare two reports.
async fn offending_identities<C: ConnectionTrait>(
    view: &C,
    query: &str,
) -> Result<Vec<String>, sea_orm::DbErr> {
    let rows = view
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await?;
    let mut identities = rows
        .iter()
        .map(|row| row.try_get::<String>("", "identity"))
        .collect::<Result<Vec<_>, _>>()?;
    identities.sort();
    identities.dedup();
    Ok(identities)
}

/// Every rule name in a list, for a uniqueness check.
#[must_use]
pub(crate) fn codes(invariants: &[Invariant]) -> Vec<&'static str> {
    invariants.iter().map(|invariant| invariant.code).collect()
}
