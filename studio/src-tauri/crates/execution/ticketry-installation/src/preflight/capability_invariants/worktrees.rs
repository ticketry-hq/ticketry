//! Git worktrees and the operation state Ticketry would continue them from.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub(crate) fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "worktree-work-item-missing",
            area: Area::Capability,
            rule: "every worktree belongs to a work item that exists",
            requires: &["worktrees.task_id", "worktracker_issue"],
            query: "SELECT worktree.id AS identity FROM worktrees worktree
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_issue item WHERE item.id = worktree.task_id)"
                .to_owned(),
        },
        Invariant {
            code: "worktree-project-missing",
            area: Area::Capability,
            rule: "a worktree's project and module exist when it records them",
            requires: &[
                "worktrees.project_id",
                "worktrees.module_id",
                "worktracker_project",
                "worktracker_issue",
            ],
            query: "SELECT worktree.id AS identity FROM worktrees worktree
                    WHERE (worktree.project_id IS NOT NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM worktracker_project project
                             WHERE project.id = worktree.project_id))
                       OR (worktree.module_id IS NOT NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM worktracker_issue module
                             WHERE module.id = worktree.module_id))"
                .to_owned(),
        },
        Invariant {
            code: "worktree-duplicate-location",
            area: Area::Capability,
            rule: "one checkout path belongs to one worktree row",
            requires: &["worktrees.path"],
            query: "SELECT one.id AS identity FROM worktrees one
                    JOIN worktrees other ON other.path = one.path AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "worktree-operation-state-unknown",
            area: Area::Capability,
            rule: "every worktree records a Git operation state Ticketry can continue from",
            requires: &["worktrees.status"],
            query: "SELECT id AS identity FROM worktrees
                    WHERE status NOT IN
                      ('active', 'integrating', 'integrated', 'discarded', 'failed')"
                .to_owned(),
        },
    ]
}
