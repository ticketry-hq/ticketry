//! Design documents and the roots they were discovered under.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "document-work-item-missing",
            area: Area::Capability,
            rule: "every design document belongs to a module and task that exist",
            requires: &[
                "design_documents.module_id",
                "design_documents.task_id",
                "worktracker_issue",
            ],
            query: "SELECT document.id AS identity FROM design_documents document
                    WHERE NOT EXISTS (
                            SELECT 1 FROM worktracker_issue module
                            WHERE module.id = document.module_id)
                       OR NOT EXISTS (
                            SELECT 1 FROM worktracker_issue task
                            WHERE task.id = document.task_id)"
                .to_owned(),
        },
        Invariant {
            code: "document-scope-unknown",
            area: Area::Capability,
            rule: "every design document records a scope Ticketry can resolve",
            requires: &["design_documents.scope"],
            query: "SELECT id AS identity FROM design_documents
                    WHERE scope NOT IN ('module', 'task')"
                .to_owned(),
        },
        Invariant {
            code: "document-duplicate-location",
            area: Area::Capability,
            rule: "one root and relative path identify one document row",
            requires: &["design_documents.root_dir", "design_documents.rel_path"],
            query: "SELECT one.id AS identity FROM design_documents one
                    JOIN design_documents other
                      ON other.root_dir = one.root_dir
                     AND other.rel_path = one.rel_path
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "document-discovering-run-missing",
            area: Area::Capability,
            rule: "a document discovered by a run points at a run that exists",
            requires: &["design_documents.discovered_by_run_id", "agent_runs"],
            query: "SELECT document.id AS identity FROM design_documents document
                    WHERE document.discovered_by_run_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM agent_runs run
                        WHERE run.id = document.discovered_by_run_id)"
                .to_owned(),
        },
    ]
}
