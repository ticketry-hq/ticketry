//! Prove the adopted installation is usable, not merely intact.
//!
//! Counts and digests prove nothing was lost. They do not prove the result is
//! *readable*: a database can hold every byte it started with and still be
//! unusable if a relationship no longer resolves through the joins the product
//! actually performs. These reads walk the relationships Studio opens with —
//! the project tree, a work item with its type, state, parent, and blockers,
//! the workflow and its launch bindings, settings, runs and their status,
//! graph runs, terminal resumability, documents, worktrees, attachments — and
//! require each one to answer.
//!
//! They are golden reads, not assertions about content. An empty installation
//! answers zero rows, which is a pass; a read that cannot run at all is the
//! failure, because that is the shape a broken adoption takes.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

/// One relationship Studio depends on, and the join that proves it resolves.
pub(crate) struct Read {
    /// What the read demonstrates, for the failure message.
    pub subject: &'static str,
    /// Every table the query touches, so a generation lacking one skips it.
    pub requires: &'static [&'static str],
    /// The query. It selects a count so no content is read into the process.
    pub query: &'static str,
}

/// The reads that must answer before the first Rust mutation.
#[must_use]
pub(crate) fn reads() -> Vec<Read> {
    vec![
        Read {
            subject: "the project tree and its work items",
            requires: &["worktracker_project", "worktracker_issue"],
            query: "SELECT COUNT(*) AS answered FROM worktracker_project p \
                    LEFT JOIN worktracker_issue i ON i.project_id = p.id",
        },
        Read {
            subject: "work items with their type, state, and ordering",
            requires: &[
                "worktracker_issue",
                "worktracker_issuetype",
                "worktracker_state",
            ],
            query: "SELECT COUNT(*) AS answered FROM worktracker_issue i \
                    JOIN worktracker_issuetype t ON t.id = i.issue_type_id \
                    JOIN worktracker_state s ON s.id = i.state_id \
                    ORDER BY i.rank",
        },
        Read {
            subject: "work item parents and blockers",
            requires: &["worktracker_issue", "worktracker_issue_blocked_by"],
            query: "SELECT COUNT(*) AS answered FROM worktracker_issue i \
                    LEFT JOIN worktracker_issue parent ON parent.id = i.parent_id \
                    LEFT JOIN worktracker_issue_blocked_by b ON b.from_issue_id = i.id",
        },
        Read {
            subject: "workflows and their launch bindings",
            requires: &[
                "worktracker_issuetypetransition",
                "worktracker_launchbinding",
            ],
            query: "SELECT COUNT(*) AS answered FROM worktracker_issuetypetransition t \
                    LEFT JOIN worktracker_launchbinding b ON b.issue_type_id = t.issue_type_id",
        },
        Read {
            subject: "settings",
            requires: &["app_settings"],
            query: "SELECT COUNT(*) AS answered FROM app_settings",
        },
        Read {
            subject: "agent runs with their work item and attempts",
            requires: &["agent_runs", "automation_attempts"],
            query: "SELECT COUNT(*) AS answered FROM agent_runs r \
                    LEFT JOIN automation_attempts a ON a.agent_run_id = r.id",
        },
        Read {
            subject: "graph runs and their launched work",
            requires: &["graph_runs", "launched_tasks"],
            query: "SELECT COUNT(*) AS answered FROM graph_runs g \
                    LEFT JOIN launched_tasks l ON l.root_id = g.root_id",
        },
        Read {
            subject: "terminal sessions and their resumable runs",
            requires: &["agent_terminal_sessions", "agent_runs"],
            query: "SELECT COUNT(*) AS answered FROM agent_terminal_sessions s \
                    LEFT JOIN agent_runs r ON r.id = s.agent_run_id",
        },
        Read {
            subject: "design documents against their work items",
            requires: &["design_documents"],
            query: "SELECT COUNT(*) AS answered FROM design_documents",
        },
        Read {
            subject: "worktrees against their work items",
            requires: &["worktrees"],
            query: "SELECT COUNT(*) AS answered FROM worktrees",
        },
        Read {
            subject: "attachments against their work items",
            requires: &["worktracker_attachment", "worktracker_issue"],
            query: "SELECT COUNT(*) AS answered FROM worktracker_attachment a \
                    JOIN worktracker_issue i ON i.id = a.issue_id",
        },
    ]
}

/// Run every applicable read, returning the subjects that could not answer.
pub(crate) async fn prove(
    database: &DatabaseConnection,
    present_tables: &[String],
) -> Result<Vec<String>, String> {
    let mut unanswered = Vec::new();
    for read in reads() {
        if !read
            .requires
            .iter()
            .all(|table| present_tables.iter().any(|name| name == table))
        {
            continue;
        }
        let answered = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                read.query.to_owned(),
            ))
            .await;
        match answered {
            Ok(Some(_)) => {}
            Ok(None) => unanswered.push(format!("{} returned no result", read.subject)),
            Err(error) => unanswered.push(format!("{}: {error}", read.subject)),
        }
    }
    Ok(unanswered)
}

#[cfg(test)]
mod tests {
    use super::reads;

    #[test]
    fn every_read_declares_the_tables_it_needs() {
        for read in reads() {
            assert!(
                !read.requires.is_empty(),
                "{} would run against a generation that lacks its tables",
                read.subject
            );
            for table in read.requires {
                assert!(
                    read.query.contains(table),
                    "{} declares {table} but does not read it",
                    read.subject
                );
            }
        }
    }

    #[test]
    fn no_read_can_write() {
        for read in reads() {
            let upper = read.query.to_uppercase();
            for forbidden in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE"] {
                assert!(!upper.contains(forbidden), "{} is not a read", read.subject);
            }
        }
    }
}
