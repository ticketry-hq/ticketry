//! Agent Runs and the Automation Attempts that start them.
//!
//! A run's lineage is what connects history to a retry. A retry chain that loops
//! or a transition claimed by two root attempts would have Ticketry either walk
//! forever or start the same work twice.

use super::super::invariant::Invariant;
use super::super::report::Area;
use super::SCOPES;

/// The rules in this group, in declaration order.
#[must_use]
pub(crate) fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "run-work-item-missing",
            area: Area::Capability,
            rule: "every Agent Run belongs to a work item that exists",
            requires: &["agent_runs.issue_id", "worktracker_issue"],
            query: "SELECT run.id AS identity FROM agent_runs run
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_issue item WHERE item.id = run.issue_id)"
                .to_owned(),
        },
        Invariant {
            code: "run-scope-unknown",
            area: Area::Capability,
            rule: "every Agent Run records a routing scope Ticketry can resume",
            requires: &["agent_runs.scope"],
            query: format!("SELECT id AS identity FROM agent_runs WHERE scope NOT IN {SCOPES}"),
        },
        Invariant {
            code: "run-resumed-from-missing",
            area: Area::Capability,
            rule: "a resumed Agent Run points at a run that exists",
            requires: &["agent_runs.resumed_from"],
            query: "SELECT run.id AS identity FROM agent_runs run
                    WHERE run.resumed_from IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM agent_runs earlier WHERE earlier.id = run.resumed_from)"
                .to_owned(),
        },
        Invariant {
            code: "run-ended-before-started",
            area: Area::Capability,
            rule: "an Agent Run does not end before it started",
            requires: &["agent_runs.started_at", "agent_runs.ended_at"],
            query: "SELECT id AS identity FROM agent_runs
                    WHERE ended_at IS NOT NULL AND ended_at < started_at"
                .to_owned(),
        },
        Invariant {
            code: "attempt-work-item-missing",
            area: Area::Capability,
            rule: "every Automation Attempt belongs to a work item that exists",
            requires: &["automation_attempts.issue_id", "worktracker_issue"],
            query: "SELECT attempt.id AS identity FROM automation_attempts attempt
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_issue item WHERE item.id = attempt.issue_id)"
                .to_owned(),
        },
        Invariant {
            code: "attempt-status-unknown",
            area: Area::Capability,
            rule: "every Automation Attempt holds a known lifecycle status",
            requires: &["automation_attempts.status"],
            query: "SELECT id AS identity FROM automation_attempts
                    WHERE status NOT IN ('pending', 'succeeded', 'failed')"
                .to_owned(),
        },
        Invariant {
            code: "attempt-agent-run-missing",
            area: Area::Capability,
            rule: "an Automation Attempt that started a run points at a run that exists",
            requires: &["automation_attempts.agent_run_id", "agent_runs"],
            query: "SELECT attempt.id AS identity FROM automation_attempts attempt
                    WHERE attempt.agent_run_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM agent_runs run WHERE run.id = attempt.agent_run_id)"
                .to_owned(),
        },
        Invariant {
            code: "attempt-retry-lineage-missing",
            area: Area::Capability,
            rule: "a retry's original attempt and root attempt exist",
            requires: &[
                "automation_attempts.retry_of_id",
                "automation_attempts.root_attempt_id",
            ],
            query: "SELECT attempt.id AS identity FROM automation_attempts attempt
                    WHERE (attempt.retry_of_id IS NOT NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM automation_attempts original
                             WHERE original.id = attempt.retry_of_id))
                       OR (attempt.root_attempt_id IS NOT NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM automation_attempts root
                             WHERE root.id = attempt.root_attempt_id))"
                .to_owned(),
        },
        Invariant {
            code: "attempt-retry-lineage-cycle",
            area: Area::Capability,
            rule: "a retry chain terminates instead of looping",
            requires: &["automation_attempts.retry_of_id"],
            query: "WITH RECURSIVE chain(root, node, depth) AS (
                      SELECT id, retry_of_id, 1 FROM automation_attempts
                      WHERE retry_of_id IS NOT NULL
                      UNION ALL
                      SELECT chain.root, attempt.retry_of_id, chain.depth + 1
                      FROM chain
                      JOIN automation_attempts attempt ON attempt.id = chain.node
                      WHERE attempt.retry_of_id IS NOT NULL AND chain.depth < 64)
                    SELECT DISTINCT root AS identity FROM chain WHERE node = root"
                .to_owned(),
        },
        Invariant {
            code: "attempt-transition-claimed-twice",
            area: Area::Capability,
            rule: "one committed transition has at most one root Automation Attempt",
            requires: &[
                "automation_attempts.retry_of_id",
                "automation_attempts.transition_id",
            ],
            query: "SELECT one.id AS identity FROM automation_attempts one
                    JOIN automation_attempts other
                      ON other.transition_id = one.transition_id AND other.id <> one.id
                    WHERE one.retry_of_id IS NULL AND other.retry_of_id IS NULL"
                .to_owned(),
        },
        Invariant {
            code: "attempt-error-details-malformed",
            area: Area::Capability,
            rule: "a recorded attempt failure detail is readable JSON",
            requires: &["automation_attempts.error_details"],
            query: "SELECT id AS identity FROM automation_attempts
                    WHERE error_details IS NOT NULL AND NOT json_valid(error_details)"
                .to_owned(),
        },
    ]
}
