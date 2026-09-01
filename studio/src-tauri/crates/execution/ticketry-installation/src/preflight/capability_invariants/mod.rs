//! The rules every migrated capability's rows must obey before adoption.
//!
//! Work Management is the installation's spine, but adoption also takes over
//! settings, Runs, automation attempts, durable status events, documents,
//! worktrees, graph execution, terminal sessions, and their launch and cleanup
//! journals. Several of those tables were written by Django without declared
//! foreign keys, and several carry constraints the Rust schema states but the
//! Django schema never did. Both classes are checked here, because a row the
//! Rust schema would reject is a row adoption cannot carry.
//!
//! Every rule here is a read. None of them contacts tmux, a provider, Git, or
//! the filesystem: a row is judged as data.

//! The list is split by capability, so the file tree names which capabilities
//! preflight covers before anyone opens a query.

mod documents;
mod effect_journals;
mod graph_execution;
mod module_links;
mod runs;
mod settings;
mod status_events;
mod terminals;
mod worktrees;

use super::invariant::Invariant;

/// The durable scopes a terminal session or launch request may be recorded in.
pub(crate) const SCOPES: &str = "('task', 'plan', 'instant', 'docchat', 'shell')";
/// The settled states an effect journal row may hold.
pub(crate) const EFFECT_STATES: &str =
    "('prepared', 'leased', 'applied', 'failed', 'conflict', 'conflicted', 'cleanup_pending')";

/// Every capability and effect-history rule, in reported order.
#[must_use]
pub(crate) fn invariants() -> Vec<Invariant> {
    let mut all = settings::invariants();
    all.extend(runs::invariants());
    all.extend(status_events::invariants());
    all.extend(documents::invariants());
    all.extend(worktrees::invariants());
    all.extend(module_links::invariants());
    all.extend(graph_execution::invariants());
    all.extend(terminals::invariants());
    all.extend(effect_journals::invariants());
    all.sort_by_key(|invariant| invariant.code);
    all
}

#[cfg(test)]
mod tests {
    use super::invariants;
    use crate::preflight::invariant::codes;
    use crate::preflight::report::Area;

    #[test]
    fn every_rule_name_is_unique() {
        let mut names = codes(&invariants());
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "two capability rules share a name");
    }

    #[test]
    fn durable_effect_history_is_covered_as_its_own_area() {
        assert!(
            invariants()
                .iter()
                .filter(|invariant| invariant.area == Area::EffectHistory)
                .count()
                >= 8,
            "effect and reconciliation history must be checked, not assumed"
        );
    }

    #[test]
    fn every_rule_selects_an_identity_and_no_content() {
        for invariant in invariants() {
            assert!(
                invariant.query.contains("AS identity"),
                "{} does not name its identity column",
                invariant.code
            );
            for content in [
                "prompt AS identity",
                "command AS identity",
                "environment AS identity",
                "path AS identity",
                "root_dir AS identity",
                "payload AS identity",
                "value AS identity",
                "intent AS identity",
            ] {
                assert!(
                    !invariant.query.contains(content),
                    "{} reports content instead of an identity",
                    invariant.code
                );
            }
        }
    }
}
