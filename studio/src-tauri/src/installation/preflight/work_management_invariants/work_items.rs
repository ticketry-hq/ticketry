//! Work Item identity, ancestry, derivation, classification, state, and rank.
//!
//! The planning tree is the structure every other capability hangs off, and the
//! rules here are the ones that keep walking it terminating and its derived
//! fields honest: an ancestry that loops, a module that is not a module, a task
//! filed under a module its parent chain does not place it in, a rank the
//! ranking algebra cannot read.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "work-item-type-unknown",
            area: Area::WorkManagement,
            rule: "every work item is a module or a task",
            requires: &["worktracker_issue.type"],
            query: "SELECT id AS identity FROM worktracker_issue
                    WHERE \"type\" NOT IN ('module', 'task')"
                .to_owned(),
        },
        Invariant {
            code: "work-item-project-missing",
            area: Area::WorkManagement,
            rule: "every work item belongs to a project that exists",
            requires: &["worktracker_issue.project_id", "worktracker_project"],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_project project
                      WHERE project.id = item.project_id)"
                .to_owned(),
        },
        Invariant {
            code: "work-item-sequence-duplicate",
            area: Area::WorkManagement,
            rule: "each human key identifies one work item inside its project",
            requires: &[
                "worktracker_issue.sequence_id",
                "worktracker_issue.project_id",
            ],
            query: "SELECT one.id AS identity FROM worktracker_issue one
                    JOIN worktracker_issue other
                      ON other.project_id = one.project_id
                     AND other.sequence_id = one.sequence_id
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "work-item-parent-missing",
            area: Area::WorkManagement,
            rule: "a work item's parent exists",
            requires: &["worktracker_issue.parent_id"],
            query: "SELECT child.id AS identity FROM worktracker_issue child
                    WHERE child.parent_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM worktracker_issue parent
                        WHERE parent.id = child.parent_id)"
                .to_owned(),
        },
        Invariant {
            code: "work-item-parent-project-mismatch",
            area: Area::WorkManagement,
            rule: "a work item and its parent belong to the same project",
            requires: &[
                "worktracker_issue.parent_id",
                "worktracker_issue.project_id",
            ],
            query: "SELECT child.id AS identity FROM worktracker_issue child
                    JOIN worktracker_issue parent ON parent.id = child.parent_id
                    WHERE parent.project_id <> child.project_id"
                .to_owned(),
        },
        Invariant {
            code: "work-item-ancestry-cycle",
            area: Area::WorkManagement,
            rule: "a work item's ancestry terminates instead of looping",
            requires: &["worktracker_issue.parent_id"],
            query: "WITH RECURSIVE ancestry(root, node, depth) AS (
                      SELECT id, parent_id, 1 FROM worktracker_issue WHERE parent_id IS NOT NULL
                      UNION ALL
                      SELECT ancestry.root, item.parent_id, ancestry.depth + 1
                      FROM ancestry
                      JOIN worktracker_issue item ON item.id = ancestry.node
                      WHERE item.parent_id IS NOT NULL AND ancestry.depth < 64)
                    SELECT DISTINCT root AS identity FROM ancestry WHERE node = root"
                .to_owned(),
        },
        Invariant {
            code: "work-item-module-missing",
            area: Area::WorkManagement,
            rule: "a work item's module exists",
            requires: &["worktracker_issue.module_id"],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    WHERE item.module_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM worktracker_issue module
                        WHERE module.id = item.module_id)"
                .to_owned(),
        },
        Invariant {
            code: "work-item-module-not-a-module",
            area: Area::WorkManagement,
            rule: "a work item's module is a module",
            requires: &["worktracker_issue.module_id", "worktracker_issue.type"],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    JOIN worktracker_issue module ON module.id = item.module_id
                    WHERE module.\"type\" <> 'module'"
                .to_owned(),
        },
        Invariant {
            code: "work-item-module-project-mismatch",
            area: Area::WorkManagement,
            rule: "a work item and its module belong to the same project",
            requires: &[
                "worktracker_issue.module_id",
                "worktracker_issue.project_id",
            ],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    JOIN worktracker_issue module ON module.id = item.module_id
                    WHERE module.project_id <> item.project_id"
                .to_owned(),
        },
        Invariant {
            code: "work-item-module-not-derived-from-parent",
            area: Area::WorkManagement,
            rule: "a task's module is the one its parent chain places it under",
            requires: &[
                "worktracker_issue.module_id",
                "worktracker_issue.parent_id",
                "worktracker_issue.type",
            ],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    JOIN worktracker_issue parent ON parent.id = item.parent_id
                    WHERE item.\"type\" = 'task'
                      AND CASE parent.\"type\"
                            WHEN 'module' THEN item.module_id IS NOT parent.id
                            ELSE item.module_id IS NOT parent.module_id
                          END"
            .to_owned(),
        },
        Invariant {
            code: "work-item-issue-type-missing",
            area: Area::WorkManagement,
            rule: "a work item's issue type exists",
            requires: &["worktracker_issue.issue_type_id", "worktracker_issuetype"],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_issuetype kind
                      WHERE kind.id = item.issue_type_id)"
                .to_owned(),
        },
        Invariant {
            code: "work-item-issue-type-project-mismatch",
            area: Area::WorkManagement,
            rule: "a work item and its issue type belong to the same project",
            requires: &[
                "worktracker_issue.issue_type_id",
                "worktracker_issue.project_id",
                "worktracker_issuetype.project_id",
            ],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    JOIN worktracker_issuetype kind ON kind.id = item.issue_type_id
                    WHERE kind.project_id <> item.project_id"
                .to_owned(),
        },
        Invariant {
            code: "work-item-issue-type-level-mismatch",
            area: Area::WorkManagement,
            rule: "a work item's own kind matches its issue type's level",
            requires: &[
                "worktracker_issue.issue_type_id",
                "worktracker_issue.type",
                "worktracker_issuetype.level",
            ],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    JOIN worktracker_issuetype kind ON kind.id = item.issue_type_id
                    WHERE kind.level <> item.\"type\""
                .to_owned(),
        },
        Invariant {
            code: "work-item-state-missing",
            area: Area::WorkManagement,
            rule: "a work item's state exists",
            requires: &["worktracker_issue.state_id", "worktracker_state"],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    WHERE item.state_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM worktracker_state state
                        WHERE state.id = item.state_id)"
                .to_owned(),
        },
        Invariant {
            code: "work-item-state-project-mismatch",
            area: Area::WorkManagement,
            rule: "a work item and its state belong to the same project",
            requires: &[
                "worktracker_issue.state_id",
                "worktracker_issue.project_id",
                "worktracker_state.project_id",
            ],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    JOIN worktracker_state state ON state.id = item.state_id
                    WHERE state.project_id <> item.project_id"
                .to_owned(),
        },
        Invariant {
            code: "work-item-state-outside-workflow",
            area: Area::WorkManagement,
            rule: "a work item sits in a state its own issue type's workflow contains",
            requires: &[
                "worktracker_issue.state_id",
                "worktracker_issue.issue_type_id",
                "worktracker_issuetype.start_state_id",
                "worktracker_issuetypetransition.issue_type_id",
                "worktracker_issuetypetransition.from_state_id",
                "worktracker_issuetypetransition.to_state_id",
            ],
            query: "SELECT item.id AS identity FROM worktracker_issue item
                    JOIN worktracker_issuetype kind ON kind.id = item.issue_type_id
                    WHERE item.state_id IS NOT NULL
                      AND kind.start_state_id IS NOT item.state_id
                      AND NOT EXISTS (
                        SELECT 1 FROM worktracker_issuetypetransition move
                        WHERE move.issue_type_id = kind.id
                          AND (move.from_state_id = item.state_id
                            OR move.to_state_id = item.state_id))"
                .to_owned(),
        },
        Invariant {
            code: "work-item-rank-syntax",
            area: Area::WorkManagement,
            rule: "every rank is a non-empty base-62 key the ranking algebra can read",
            requires: &["worktracker_issue.rank"],
            query: "SELECT id AS identity FROM worktracker_issue
                    WHERE rank = '' OR rank GLOB '*[^0-9A-Za-z]*'"
                .to_owned(),
        },
        Invariant {
            code: "work-item-revision-negative",
            area: Area::WorkManagement,
            rule: "a work item revision never runs backwards past zero",
            requires: &["worktracker_issue.state_revision"],
            query: "SELECT id AS identity FROM worktracker_issue WHERE state_revision < 0"
                .to_owned(),
        },
    ]
}
