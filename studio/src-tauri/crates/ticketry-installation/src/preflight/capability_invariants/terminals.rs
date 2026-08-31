//! Durable terminal sessions and the viewer leases over them.
//!
//! A session is durable and a lease is disposable, so the rules differ: a
//! session must stay resumable — one live tmux name, a scope Ticketry can route,
//! a monotonic output sequence — while a lease need only name a transport that
//! can render.

use super::super::invariant::Invariant;
use super::super::report::Area;
use super::SCOPES;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "terminal-session-run-missing",
            area: Area::Capability,
            rule: "every durable terminal session belongs to an Agent Run that exists",
            requires: &["agent_terminal_sessions.agent_run_id", "agent_runs"],
            query: "SELECT session.agent_run_id AS identity FROM agent_terminal_sessions session
                    WHERE NOT EXISTS (
                      SELECT 1 FROM agent_runs run WHERE run.id = session.agent_run_id)"
                .to_owned(),
        },
        Invariant {
            code: "terminal-session-scope-unknown",
            area: Area::Capability,
            rule: "every terminal session records a resumable scope",
            requires: &["agent_terminal_sessions.scope"],
            query: format!(
                "SELECT agent_run_id AS identity FROM agent_terminal_sessions
                 WHERE scope NOT IN {SCOPES}"
            ),
        },
        Invariant {
            code: "terminal-session-document-scope-mismatch",
            area: Area::Capability,
            rule: "a document-chat session records a document path and no other session does",
            requires: &[
                "agent_terminal_sessions.scope",
                "agent_terminal_sessions.doc_rel_path",
            ],
            query: "SELECT agent_run_id AS identity FROM agent_terminal_sessions
                    WHERE (scope = 'docchat') <> (doc_rel_path IS NOT NULL)"
                .to_owned(),
        },
        Invariant {
            code: "terminal-session-tmux-name-shared",
            area: Area::Capability,
            rule: "one live tmux session name belongs to one terminal session",
            requires: &[
                "agent_terminal_sessions.tmux_session_name",
                "agent_terminal_sessions.terminated_at",
            ],
            query: "SELECT one.agent_run_id AS identity FROM agent_terminal_sessions one
                    JOIN agent_terminal_sessions other
                      ON other.tmux_session_name = one.tmux_session_name
                     AND other.agent_run_id <> one.agent_run_id
                    WHERE one.terminated_at IS NULL AND other.terminated_at IS NULL"
                .to_owned(),
        },
        Invariant {
            code: "terminal-session-output-sequence-negative",
            area: Area::Capability,
            rule: "a terminal session's output sequence never runs backwards past zero",
            requires: &["agent_terminal_sessions.output_sequence"],
            query: "SELECT agent_run_id AS identity FROM agent_terminal_sessions
                    WHERE output_sequence < 0"
                .to_owned(),
        },
        Invariant {
            code: "terminal-session-terminated-before-created",
            area: Area::Capability,
            rule: "a terminal session does not terminate before it was created",
            requires: &[
                "agent_terminal_sessions.created_at",
                "agent_terminal_sessions.terminated_at",
            ],
            query: "SELECT agent_run_id AS identity FROM agent_terminal_sessions
                    WHERE terminated_at IS NOT NULL AND terminated_at < created_at"
                .to_owned(),
        },
        Invariant {
            code: "viewer-lease-run-missing",
            area: Area::Capability,
            rule: "every viewer lease belongs to an Agent Run that exists",
            requires: &["agent_run_viewer_leases.agent_run_id", "agent_runs"],
            query: "SELECT lease.agent_run_id AS identity FROM agent_run_viewer_leases lease
                    WHERE NOT EXISTS (
                      SELECT 1 FROM agent_runs run WHERE run.id = lease.agent_run_id)"
                .to_owned(),
        },
        Invariant {
            code: "viewer-lease-transport-unknown",
            area: Area::Capability,
            rule: "every viewer lease names a transport Ticketry renders",
            requires: &["agent_run_viewer_leases.transport"],
            query: "SELECT agent_run_id AS identity FROM agent_run_viewer_leases
                    WHERE transport NOT IN ('native', 'xterm')"
                .to_owned(),
        },
    ]
}
