//! The Work Management rules a structurally valid installation must also obey.
//!
//! Structure says a row exists and its declared foreign keys resolve. Meaning
//! says the row is one Ticketry can plan with: an ancestry that terminates, a
//! state its own workflow admits, a rank the ranking algebra can read, a
//! sequence counter that will not reissue an existing key. Adoption preserves
//! whatever it finds, so anything meaningless here stays meaningless after the
//! migration — which is why it is refused before the migration instead.

//! The list is split by what it is about, so the file tree names what preflight
//! checks before anyone opens a query.

pub mod catalogue;
pub mod dependencies;
pub mod projects;
pub mod work_items;
pub mod workflow;

use super::invariant::Invariant;

/// Every Work Management rule, in reported order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    let mut all = projects::invariants();
    all.extend(workflow::invariants());
    all.extend(work_items::invariants());
    all.extend(dependencies::invariants());
    all.extend(catalogue::invariants());
    all.sort_by_key(|invariant| invariant.code);
    all
}

#[cfg(test)]
mod tests {
    use super::invariants;
    use crate::installation::preflight::invariant::codes;

    #[test]
    fn every_rule_name_is_unique() {
        let mut names = codes(&invariants());
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "two Work Management rules share a name");
    }

    #[test]
    fn both_graph_walks_are_bounded() {
        // A cycle is found long before the bound. The bound exists so a cyclic
        // graph cannot make the walk itself unbounded, and it sits far past any
        // real planning depth.
        let bounded = invariants()
            .into_iter()
            .filter(|invariant| invariant.query.contains("RECURSIVE"))
            .collect::<Vec<_>>();
        assert_eq!(bounded.len(), 2, "ancestry and blockers are the two walks");
        for invariant in bounded {
            assert!(
                invariant.query.contains("depth < 64"),
                "{} walks without a bound",
                invariant.code
            );
        }
    }

    #[test]
    fn every_rule_selects_an_identity_and_no_content() {
        // A rule's result column is reported verbatim, so it must be an
        // identifier. A rule that selected a name, path, or prompt would turn
        // the report into a content extract.
        for invariant in invariants() {
            assert!(
                invariant.query.contains("AS identity"),
                "{} does not name its identity column",
                invariant.code
            );
            for content in ["name", "description", "prompt", "color", "slug AS"] {
                assert!(
                    !invariant.query.contains(&format!("{content} AS identity")),
                    "{} reports content instead of an identity",
                    invariant.code
                );
            }
        }
    }
}
