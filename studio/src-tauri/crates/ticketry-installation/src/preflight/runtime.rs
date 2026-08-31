//! Read the recorded runtime names and report what the name rules say.
//!
//! The rules live in [`super::runtime_names`]; this module reads the rows. It
//! contacts nothing: tmux is not run, no session is listed, and no live runtime
//! state is touched or changed. Whether a session is still alive is
//! reconciliation's question, asked long after adoption commits — preflight's
//! question is only whether the recorded name is one Ticketry may ever pass to
//! tmux at all.

use sea_orm::{ConnectionTrait, DbBackend, Statement};

use super::error::{PreflightError, PreflightFailure};
use super::invariant::Findings;
use super::report::{Area, REPORTED_IDENTITIES};
use super::runtime_names::{self, NameDefect};
use super::schema::Schema;

/// Check every recorded tmux session name and runtime namespace.
///
/// # Errors
///
/// Returns [`PreflightFailure::UnreadableInstallation`] when the terminal
/// session rows cannot be read.
pub async fn check<C: ConnectionTrait>(
    view: &C,
    schema: &Schema,
    findings: &mut Findings,
) -> Result<(), PreflightError> {
    if !schema.satisfies("agent_terminal_sessions.tmux_session_name") {
        findings.skipped.push(super::report::Skipped {
            code: "runtime-names".to_owned(),
            missing_requirement: "agent_terminal_sessions.tmux_session_name".to_owned(),
        });
        return Ok(());
    }
    let namespaced = schema.satisfies("agent_terminal_sessions.runtime_namespace");
    findings.checked += 1;

    let query = format!(
        "SELECT agent_run_id AS identity, tmux_session_name AS session_name{namespace}
         FROM agent_terminal_sessions",
        namespace = if namespaced {
            ", runtime_namespace AS namespace"
        } else {
            ", NULL AS namespace"
        }
    );
    let rows = view
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
        .await
        .map_err(|error| unreadable(format!("could not read terminal session names: {error}")))?;

    let mut offences: Vec<(NameDefect, String)> = Vec::new();
    for row in rows {
        let identity = row
            .try_get::<String>("", "identity")
            .map_err(|error| unreadable(format!("could not read a session identity: {error}")))?;
        let recorded = row
            .try_get::<Option<String>>("", "session_name")
            .unwrap_or_default()
            .unwrap_or_default();
        if let Some(defect) = runtime_names::session_name(&identity, &recorded) {
            offences.push((defect, identity.clone()));
        }
        // A namespace is optional: a session recorded before namespacing has
        // none, and reconciliation treats that as the legacy namespace rather
        // than as a defect.
        if let Some(namespace) = row
            .try_get::<Option<String>>("", "namespace")
            .unwrap_or_default()
        {
            if let Some(defect) = runtime_names::runtime_namespace(&namespace) {
                offences.push((defect, identity));
            }
        }
    }

    offences.sort_by(|left, right| left.1.cmp(&right.1));
    for defect in [
        NameDefect::UnsafeSessionName,
        NameDefect::SessionNameForAnotherRun,
        NameDefect::UnsafeRuntimeNamespace,
    ] {
        let affected = offences
            .iter()
            .filter(|(found, _)| *found == defect)
            .map(|(_, identity)| identity.clone())
            .collect::<Vec<_>>();
        findings.record(
            defect.code(),
            Area::Runtime,
            defect.rule(),
            affected.iter().take(REPORTED_IDENTITIES).cloned().collect(),
            affected.len() as u64,
        );
    }
    Ok(())
}

fn unreadable(detail: String) -> PreflightError {
    PreflightError::new(PreflightFailure::UnreadableInstallation, detail)
}
