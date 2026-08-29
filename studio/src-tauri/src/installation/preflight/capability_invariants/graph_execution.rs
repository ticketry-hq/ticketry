//! Graph Runs and the launch claims that record what they already started.
//!
//! A claim is what stops a Graph Run launching the same work item twice. A claim
//! without its Graph Run, or two claims sharing one Agent Run, is a ledger that
//! can no longer answer that question.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "graph-run-root-missing",
            area: Area::Capability,
            rule: "every Graph Run's root work item and project exist",
            requires: &[
                "graph_runs.root_id",
                "graph_runs.project_id",
                "worktracker_issue",
                "worktracker_project",
            ],
            query: "SELECT graph.root_id AS identity FROM graph_runs graph
                    WHERE NOT EXISTS (
                            SELECT 1 FROM worktracker_issue root
                            WHERE root.id = graph.root_id)
                       OR NOT EXISTS (
                            SELECT 1 FROM worktracker_project project
                            WHERE project.id = graph.project_id)"
                .to_owned(),
        },
        Invariant {
            code: "graph-run-project-mismatch",
            area: Area::Capability,
            rule: "a Graph Run and its root work item belong to the same project",
            requires: &[
                "graph_runs.root_id",
                "graph_runs.project_id",
                "worktracker_issue.project_id",
            ],
            query: "SELECT graph.root_id AS identity FROM graph_runs graph
                    JOIN worktracker_issue root ON root.id = graph.root_id
                    WHERE root.project_id <> graph.project_id"
                .to_owned(),
        },
        Invariant {
            code: "graph-run-execution-mode-unknown",
            area: Area::Capability,
            rule: "every Graph Run records a known execution mode",
            requires: &["graph_runs.execution_mode"],
            query: "SELECT root_id AS identity FROM graph_runs
                    WHERE execution_mode NOT IN ('serial', 'parallel')"
                .to_owned(),
        },
        Invariant {
            code: "graph-run-launch-configuration-malformed",
            area: Area::Capability,
            rule: "a Graph Run's stored launch configuration is readable JSON",
            requires: &["graph_runs.launch_configuration"],
            query: "SELECT root_id AS identity FROM graph_runs
                    WHERE launch_configuration IS NOT NULL
                      AND NOT json_valid(launch_configuration)"
                .to_owned(),
        },
        Invariant {
            code: "launch-claim-graph-missing",
            area: Area::Capability,
            rule: "every launch claim belongs to a Graph Run that exists",
            requires: &[
                "launched_tasks.task_id",
                "launched_tasks.root_id",
                "graph_runs.root_id",
            ],
            query: "SELECT claim.task_id AS identity FROM launched_tasks claim
                    WHERE NOT EXISTS (
                      SELECT 1 FROM graph_runs graph WHERE graph.root_id = claim.root_id)"
                .to_owned(),
        },
        Invariant {
            code: "launch-claim-run-missing",
            area: Area::Capability,
            rule: "every launch claim points at an Agent Run that exists",
            requires: &[
                "launched_tasks.task_id",
                "launched_tasks.agent_run_id",
                "agent_runs",
            ],
            query: "SELECT claim.task_id AS identity FROM launched_tasks claim
                    WHERE NOT EXISTS (
                      SELECT 1 FROM agent_runs run WHERE run.id = claim.agent_run_id)"
                .to_owned(),
        },
        Invariant {
            code: "launch-claim-run-shared",
            area: Area::Capability,
            rule: "one Agent Run is claimed by one launch claim",
            requires: &["launched_tasks.task_id", "launched_tasks.agent_run_id"],
            query: "SELECT one.task_id AS identity FROM launched_tasks one
                    JOIN launched_tasks other
                      ON other.agent_run_id = one.agent_run_id AND other.task_id <> one.task_id"
                .to_owned(),
        },
        Invariant {
            code: "launch-claim-work-item-missing",
            area: Area::Capability,
            rule: "every launch claim names a work item that exists",
            requires: &["launched_tasks.task_id", "worktracker_issue"],
            query: "SELECT claim.task_id AS identity FROM launched_tasks claim
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_issue item WHERE item.id = claim.task_id)"
                .to_owned(),
        },
    ]
}
