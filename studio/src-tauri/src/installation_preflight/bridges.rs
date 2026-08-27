//! The only way a defect may be admitted instead of refused.
//!
//! Ticketry's adoption sequence is allowed to repair exactly one class of
//! problem: a defect a named, versioned, tested bridge already knows how to
//! fix. Everything else stops. That rule exists because the alternative — a
//! startup path that cleans up whatever it finds — deletes or rewrites live
//! user data on the strength of a guess, in the one step of the migration that
//! cannot be undone.
//!
//! So admission is a lookup, not a judgement. A defect is admitted only when
//! this registry names it, and the registry entry names the bridge and its
//! version. Preflight itself never repairs, and it never runs a bridge: it
//! reports which bridges an installation would need and leaves the source
//! exactly as it found it.
//!
//! The registry contains only defects reproduced from a shipped installation.
//! Each entry has a matching transactional repair and fixture in installation
//! adoption. An entry added "just in case" would be an untested licence to
//! modify user data and does not belong here.

use super::report::Defect;

/// One reviewed admission: a defect a named bridge is known to repair.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Bridge {
    /// The rule whose defect this bridge admits.
    pub defect_code: &'static str,
    /// The bridge's name, as recorded in the migration ledger.
    pub name: &'static str,
    /// The bridge's version. A bridge is re-reviewed, never edited in place.
    pub version: u32,
    /// The generations the admission applies to. Empty means every generation.
    pub generations: &'static [&'static str],
}

impl Bridge {
    /// The bridge's stable identity, as it appears in a report and a ledger.
    #[must_use]
    pub fn identity(&self) -> String {
        format!("{}.v{}", self.name, self.version)
    }

    fn admits(&self, defect: &Defect, generation: &str) -> bool {
        self.defect_code == defect.code
            && (self.generations.is_empty() || self.generations.contains(&generation))
    }
}

/// Every reviewed admission this release ships.
pub const REGISTRY: &[Bridge] = &[Bridge {
    defect_code: "document-work-item-missing",
    name: "remove-orphaned-design-document-metadata",
    version: 1,
    generations: &["rust-owned"],
}];

/// Mark the defects a bridge admits, leaving the rest as refusals.
///
/// Admission is per generation: a defect a bridge repairs in one historical
/// schema is not thereby repairable in another, because the bridge was tested
/// against the schema it was written for.
pub fn admit(defects: &mut [Defect], generation: &str, registry: &[Bridge]) {
    for defect in defects {
        defect.admitted_by = registry
            .iter()
            .find(|bridge| bridge.admits(defect, generation))
            .map(Bridge::identity);
    }
}

#[cfg(test)]
mod tests {
    use super::{admit, Bridge, REGISTRY};
    use crate::installation_preflight::report::{Area, Defect};

    fn defect(code: &str) -> Defect {
        Defect {
            code: code.to_owned(),
            area: Area::WorkManagement,
            rule: "a rule".to_owned(),
            count: 1,
            affected: vec!["0000".to_owned()],
            truncated: false,
            admitted_by: None,
        }
    }

    #[test]
    fn every_shipped_admission_is_narrow_and_versioned() {
        assert_eq!(REGISTRY.len(), 1);
        assert_eq!(REGISTRY[0].defect_code, "document-work-item-missing");
        assert_eq!(
            REGISTRY[0].identity(),
            "remove-orphaned-design-document-metadata.v1"
        );
        assert_eq!(REGISTRY[0].generations, &["rust-owned"]);
    }

    #[test]
    fn an_unregistered_defect_is_never_admitted() {
        let mut defects = vec![defect("work-item-rank-syntax")];
        admit(&mut defects, "django-current", REGISTRY);
        assert_eq!(defects[0].admitted_by, None);
    }

    #[test]
    fn a_registered_defect_is_admitted_by_its_named_version() {
        let registry = &[Bridge {
            defect_code: "work-item-rank-syntax",
            name: "repair-legacy-ranks",
            version: 2,
            generations: &[],
        }];
        let mut defects = vec![defect("work-item-rank-syntax"), defect("blocker-cycle")];
        admit(&mut defects, "django-current", registry);
        assert_eq!(
            defects[0].admitted_by.as_deref(),
            Some("repair-legacy-ranks.v2")
        );
        assert_eq!(defects[1].admitted_by, None);
    }

    #[test]
    fn an_admission_does_not_leak_to_a_generation_it_was_not_tested_against() {
        let registry = &[Bridge {
            defect_code: "work-item-rank-syntax",
            name: "repair-legacy-ranks",
            version: 1,
            generations: &["worktracker-0012"],
        }];
        let mut defects = vec![defect("work-item-rank-syntax")];
        admit(&mut defects, "django-current", registry);
        assert_eq!(defects[0].admitted_by, None);

        admit(&mut defects, "worktracker-0012", registry);
        assert!(defects[0].is_admitted());
    }
}
