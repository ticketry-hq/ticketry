//! Durable effect history and the reconciliation journals over it.
//!
//! These rows are the record of what Ticketry already did outside its own
//! database — a provider launched, a tmux session killed, a Git operation
//! applied. Reconciliation reads them after a crash to decide what still needs
//! finishing, so a row whose state contradicts its own lease or settlement
//! fields is one it can neither resume nor abandon.

use super::super::invariant::Invariant;
use super::super::report::Area;
use super::{EFFECT_STATES, SCOPES};

/// The rules in this group, in declaration order.
#[must_use]
pub(crate) fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "terminal-launch-request-run-missing",
            area: Area::EffectHistory,
            rule: "every recorded terminal launch belongs to an Agent Run that exists",
            requires: &["terminal_launch_requests.agent_run_id", "agent_runs"],
            query: "SELECT request.effect_id AS identity FROM terminal_launch_requests request
                    WHERE NOT EXISTS (
                      SELECT 1 FROM agent_runs run WHERE run.id = request.agent_run_id)"
                .to_owned(),
        },
        Invariant {
            code: "terminal-launch-request-run-shared",
            area: Area::EffectHistory,
            rule: "one Agent Run has at most one recorded terminal launch",
            requires: &[
                "terminal_launch_requests.effect_id",
                "terminal_launch_requests.agent_run_id",
            ],
            query: "SELECT one.effect_id AS identity FROM terminal_launch_requests one
                    JOIN terminal_launch_requests other
                      ON other.agent_run_id = one.agent_run_id
                     AND other.effect_id <> one.effect_id"
                .to_owned(),
        },
        Invariant {
            code: "terminal-launch-request-scope-unknown",
            area: Area::EffectHistory,
            rule: "every recorded terminal launch records a resumable scope",
            requires: &["terminal_launch_requests.scope"],
            query: format!(
                "SELECT effect_id AS identity FROM terminal_launch_requests
                 WHERE scope NOT IN {SCOPES}"
            ),
        },
        Invariant {
            code: "terminal-launch-request-document-scope-mismatch",
            area: Area::EffectHistory,
            rule: "a document-chat launch records a document path and no other launch does",
            requires: &[
                "terminal_launch_requests.scope",
                "terminal_launch_requests.doc_rel_path",
            ],
            query: "SELECT effect_id AS identity FROM terminal_launch_requests
                    WHERE (scope = 'docchat') <> (doc_rel_path IS NOT NULL)"
                .to_owned(),
        },
        Invariant {
            code: "terminal-launch-request-geometry-invalid",
            area: Area::EffectHistory,
            rule: "every recorded terminal launch has a positive terminal geometry",
            requires: &[
                "terminal_launch_requests.columns",
                "terminal_launch_requests.rows",
            ],
            query: "SELECT effect_id AS identity FROM terminal_launch_requests
                    WHERE \"columns\" <= 0 OR \"rows\" <= 0"
                .to_owned(),
        },
        Invariant {
            code: "terminal-launch-request-environment-malformed",
            area: Area::EffectHistory,
            rule: "a recorded terminal launch's environment is a JSON object",
            requires: &["terminal_launch_requests.environment"],
            query: "SELECT effect_id AS identity FROM terminal_launch_requests
                    WHERE NOT (json_valid(environment) AND json_type(environment) = 'object')"
                .to_owned(),
        },
        Invariant {
            code: "launch-policy-effect-identity-shared",
            area: Area::EffectHistory,
            rule: "one caller scope and idempotency key identify one launch decision",
            requires: &[
                "launch_policy_effects.decision_id",
                "launch_policy_effects.caller_scope",
                "launch_policy_effects.idempotency_key",
            ],
            query: "SELECT one.decision_id AS identity FROM launch_policy_effects one
                    JOIN launch_policy_effects other
                      ON other.caller_scope = one.caller_scope
                     AND other.idempotency_key = one.idempotency_key
                     AND other.decision_id <> one.decision_id"
                .to_owned(),
        },
        Invariant {
            code: "launch-policy-effect-result-malformed",
            area: Area::EffectHistory,
            rule: "a recorded launch decision's result is readable JSON",
            requires: &["launch_policy_effects.result"],
            query: "SELECT decision_id AS identity FROM launch_policy_effects
                    WHERE result IS NOT NULL AND NOT json_valid(result)"
                .to_owned(),
        },
        Invariant {
            code: "launch-effect-state-unknown",
            area: Area::EffectHistory,
            rule: "every prepared launch effect holds a state reconciliation understands",
            requires: &["runs_launch_effects.state"],
            query: format!(
                "SELECT effect_id AS identity FROM runs_launch_effects
                 WHERE state NOT IN {EFFECT_STATES}"
            ),
        },
        Invariant {
            code: "launch-effect-lease-inconsistent",
            area: Area::EffectHistory,
            rule: "a leased launch effect names its owner and expiry, and only a leased one does",
            requires: &[
                "runs_launch_effects.state",
                "runs_launch_effects.lease_owner",
                "runs_launch_effects.lease_expires_at",
            ],
            query: "SELECT effect_id AS identity FROM runs_launch_effects
                    WHERE (state = 'leased')
                       <> (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)"
                .to_owned(),
        },
        Invariant {
            code: "launch-effect-application-inconsistent",
            area: Area::EffectHistory,
            rule: "an applied launch effect records when it applied, and only an applied one does",
            requires: &[
                "runs_launch_effects.state",
                "runs_launch_effects.applied_at",
                "runs_launch_effects.attempt_count",
            ],
            query: "SELECT effect_id AS identity FROM runs_launch_effects
                    WHERE (state = 'applied') <> (applied_at IS NOT NULL)
                       OR attempt_count < 0"
                .to_owned(),
        },
        Invariant {
            code: "launch-effect-run-shared",
            area: Area::EffectHistory,
            rule: "one Agent Run has at most one prepared launch effect",
            requires: &[
                "runs_launch_effects.effect_id",
                "runs_launch_effects.agent_run_id",
            ],
            query: "SELECT one.effect_id AS identity FROM runs_launch_effects one
                    JOIN runs_launch_effects other
                      ON other.agent_run_id = one.agent_run_id
                     AND other.effect_id <> one.effect_id"
                .to_owned(),
        },
        Invariant {
            code: "cleanup-effect-state-unknown",
            area: Area::EffectHistory,
            rule: "every terminal cleanup effect holds a state reconciliation understands",
            requires: &["terminal_cleanup_effects.state"],
            query: format!(
                "SELECT effect_id AS identity FROM terminal_cleanup_effects
                 WHERE state NOT IN {EFFECT_STATES}"
            ),
        },
        Invariant {
            code: "cleanup-effect-lease-inconsistent",
            area: Area::EffectHistory,
            rule: "a leased cleanup effect names its owner and expiry, and only a leased one does",
            requires: &[
                "terminal_cleanup_effects.state",
                "terminal_cleanup_effects.lease_owner",
                "terminal_cleanup_effects.lease_expires_at",
            ],
            query: "SELECT effect_id AS identity FROM terminal_cleanup_effects
                    WHERE (state = 'leased')
                       <> (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)"
                .to_owned(),
        },
        Invariant {
            code: "cleanup-effect-session-missing",
            area: Area::EffectHistory,
            rule: "every cleanup effect names a terminal session that exists",
            requires: &[
                "terminal_cleanup_effects.agent_run_id",
                "agent_terminal_sessions.agent_run_id",
            ],
            query: "SELECT effect.effect_id AS identity FROM terminal_cleanup_effects effect
                    WHERE NOT EXISTS (
                      SELECT 1 FROM agent_terminal_sessions session
                      WHERE session.agent_run_id = effect.agent_run_id)"
                .to_owned(),
        },
        Invariant {
            code: "reconciliation-operation-state-unknown",
            area: Area::EffectHistory,
            rule: "every workspace operation holds a state reconciliation understands",
            requires: &["workspace_operations.state"],
            query: format!(
                "SELECT operation_id AS identity FROM workspace_operations
                 WHERE state NOT IN {EFFECT_STATES}"
            ),
        },
        Invariant {
            code: "reconciliation-operation-intent-malformed",
            area: Area::EffectHistory,
            rule: "every workspace operation carries a JSON object intent",
            requires: &["workspace_operations.intent"],
            query: "SELECT operation_id AS identity FROM workspace_operations
                    WHERE NOT (json_valid(intent) AND json_type(intent) = 'object')"
                .to_owned(),
        },
        Invariant {
            code: "reconciliation-operation-settlement-inconsistent",
            area: Area::EffectHistory,
            rule:
                "a settled workspace operation records when it settled, and only a settled one does",
            requires: &[
                "workspace_operations.state",
                "workspace_operations.settled_at",
                "workspace_operations.attempt_count",
            ],
            query: "SELECT operation_id AS identity FROM workspace_operations
                    WHERE (state IN ('applied', 'conflicted', 'failed'))
                       <> (settled_at IS NOT NULL)
                       OR attempt_count < 0"
                .to_owned(),
        },
    ]
}
