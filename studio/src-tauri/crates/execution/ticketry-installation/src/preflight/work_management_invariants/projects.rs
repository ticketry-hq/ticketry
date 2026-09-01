//! Workspace and project identity, and the counter that issues human keys.
//!
//! A project's sequence counter is the one piece of Work Management state that
//! hands out a value: if it sits below a key already issued, the next work item
//! created after adoption takes an existing item's key. That is unrecoverable
//! from inside Ticketry, so it is checked before adoption rather than after.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub(crate) fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "workspace-duplicate-slug",
            area: Area::WorkManagement,
            rule: "each workspace slug identifies one workspace",
            requires: &["worktracker_workspace.slug"],
            query: "SELECT one.id AS identity FROM worktracker_workspace one
                    JOIN worktracker_workspace other
                      ON other.slug = one.slug AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "project-duplicate-slug",
            area: Area::WorkManagement,
            rule: "each project slug identifies one project inside its workspace",
            requires: &[
                "worktracker_project.slug",
                "worktracker_project.workspace_id",
            ],
            query: "SELECT one.id AS identity FROM worktracker_project one
                    JOIN worktracker_project other
                      ON other.workspace_id = one.workspace_id
                     AND other.slug = one.slug
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            // Removing Workspace promoted the slug to a global identity. The
            // rule is gated on the onboarding column, which exists only in the
            // project-only generation, so a Workspace-era source is reported as
            // not applicable instead of being judged by the newer rule.
            code: "project-slug-not-globally-unique",
            area: Area::WorkManagement,
            rule: "each project slug identifies one project in the installation",
            requires: &[
                "worktracker_project.slug",
                "worktracker_project.onboarding_required",
            ],
            query: "SELECT one.id AS identity FROM worktracker_project one
                    JOIN worktracker_project other
                      ON other.slug = one.slug AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "project-workspace-missing",
            area: Area::WorkManagement,
            rule: "every project belongs to a workspace that exists",
            requires: &["worktracker_project.workspace_id", "worktracker_workspace"],
            query: "SELECT project.id AS identity FROM worktracker_project project
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_workspace workspace
                      WHERE workspace.id = project.workspace_id)"
                .to_owned(),
        },
        Invariant {
            code: "project-sequence-counter-behind",
            area: Area::WorkManagement,
            rule: "a project's sequence counter is at least its highest issued key",
            requires: &[
                "worktracker_project.seq_counter",
                "worktracker_issue.sequence_id",
                "worktracker_issue.project_id",
            ],
            query: "SELECT project.id AS identity FROM worktracker_project project
                    JOIN worktracker_issue item ON item.project_id = project.id
                    GROUP BY project.id
                    HAVING MAX(item.sequence_id) > project.seq_counter"
                .to_owned(),
        },
        Invariant {
            code: "project-revision-negative",
            area: Area::WorkManagement,
            rule: "a project revision never runs backwards past zero",
            requires: &["worktracker_project.state_revision"],
            query: "SELECT id AS identity FROM worktracker_project WHERE state_revision < 0"
                .to_owned(),
        },
    ]
}
