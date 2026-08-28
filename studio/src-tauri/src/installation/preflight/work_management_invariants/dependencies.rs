//! The blocker graph, which execution order is derived from.
//!
//! A cycle here is not a cosmetic defect: graph execution resolves what to run
//! next by walking blockers, so a loop means there is no order to run at all.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "blocker-self-reference",
            area: Area::WorkManagement,
            rule: "no work item blocks itself",
            requires: &[
                "worktracker_issue_blocked_by.from_issue_id",
                "worktracker_issue_blocked_by.to_issue_id",
            ],
            query: "SELECT from_issue_id AS identity FROM worktracker_issue_blocked_by
                    WHERE from_issue_id = to_issue_id"
                .to_owned(),
        },
        Invariant {
            code: "blocker-endpoint-missing",
            area: Area::WorkManagement,
            rule: "both endpoints of a blocker edge exist",
            requires: &[
                "worktracker_issue_blocked_by.from_issue_id",
                "worktracker_issue_blocked_by.to_issue_id",
                "worktracker_issue",
            ],
            query: "SELECT CAST(edge.id AS TEXT) AS identity
                    FROM worktracker_issue_blocked_by edge
                    WHERE NOT EXISTS (
                            SELECT 1 FROM worktracker_issue item
                            WHERE item.id = edge.from_issue_id)
                       OR NOT EXISTS (
                            SELECT 1 FROM worktracker_issue item
                            WHERE item.id = edge.to_issue_id)"
                .to_owned(),
        },
        Invariant {
            code: "blocker-cross-project",
            area: Area::WorkManagement,
            rule: "a blocker edge joins two work items in the same project",
            requires: &[
                "worktracker_issue_blocked_by.from_issue_id",
                "worktracker_issue_blocked_by.to_issue_id",
                "worktracker_issue.project_id",
            ],
            query: "SELECT CAST(edge.id AS TEXT) AS identity
                    FROM worktracker_issue_blocked_by edge
                    JOIN worktracker_issue blocked ON blocked.id = edge.from_issue_id
                    JOIN worktracker_issue blocker ON blocker.id = edge.to_issue_id
                    WHERE blocked.project_id <> blocker.project_id"
                .to_owned(),
        },
        Invariant {
            code: "blocker-duplicate",
            area: Area::WorkManagement,
            rule: "one blocker relationship is recorded once",
            requires: &[
                "worktracker_issue_blocked_by.from_issue_id",
                "worktracker_issue_blocked_by.to_issue_id",
            ],
            query: "SELECT CAST(one.id AS TEXT) AS identity
                    FROM worktracker_issue_blocked_by one
                    JOIN worktracker_issue_blocked_by other
                      ON other.from_issue_id = one.from_issue_id
                     AND other.to_issue_id = one.to_issue_id
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "blocker-cycle",
            area: Area::WorkManagement,
            rule: "the blocker graph is acyclic, so execution order exists",
            requires: &[
                "worktracker_issue_blocked_by.from_issue_id",
                "worktracker_issue_blocked_by.to_issue_id",
            ],
            query: "WITH RECURSIVE reach(root, node, depth) AS (
                      SELECT from_issue_id, to_issue_id, 1 FROM worktracker_issue_blocked_by
                      UNION ALL
                      SELECT reach.root, edge.to_issue_id, reach.depth + 1
                      FROM reach
                      JOIN worktracker_issue_blocked_by edge ON edge.from_issue_id = reach.node
                      WHERE reach.depth < 64)
                    SELECT DISTINCT root AS identity FROM reach WHERE node = root"
                .to_owned(),
        },
    ]
}
