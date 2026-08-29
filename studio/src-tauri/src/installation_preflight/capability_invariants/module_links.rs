//! Typed Module Links, which decide where a Module's code is checked out.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "module-link-module-unknown",
            area: Area::Capability,
            rule: "every module link names a Work Item that is a module",
            requires: &[
                "module_links.id",
                "module_links.module_id",
                "worktracker_issue.id",
                "worktracker_issue.type",
            ],
            query: "SELECT link.id AS identity FROM module_links link
                    WHERE NOT EXISTS (
                        SELECT 1 FROM worktracker_issue issue
                        WHERE issue.id = link.module_id AND issue.type = 'module')"
                .to_owned(),
        },
        Invariant {
            code: "module-link-module-duplicated",
            area: Area::Capability,
            rule: "a module owns at most one link",
            requires: &["module_links.id", "module_links.module_id"],
            query: "SELECT one.id AS identity FROM module_links one
                    JOIN module_links other
                      ON other.module_id = one.module_id AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "module-link-path-malformed",
            area: Area::Capability,
            rule: "every module link records a non-empty, untrimmed-free local folder",
            requires: &["module_links.id", "module_links.path"],
            query: "SELECT id AS identity FROM module_links
                    WHERE path = '' OR path <> trim(path)"
                .to_owned(),
        },
    ]
}
