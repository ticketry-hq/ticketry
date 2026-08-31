//! Which Agent Runs deserve a live watcher, read from durable truth.
//!
//! Eligibility is a database question, never an in-memory one. That is what
//! makes restart reconstruction fall out for free: after a crash there is no
//! surviving handle to consult, but the runs that were live are still recorded
//! as live, still name their design directory, and are therefore still
//! eligible. It is also what makes stopping correct — a run that reached a
//! terminal status stops being eligible the moment its row says so, whichever
//! path wrote that row.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::documents::{DocumentsError, RegistrationIdentity, SCRATCH_TASK_ID};
use ticketry_entities::runs::agent_run;

/// The statuses that end a run. Everything else is still live: a status this
/// build does not recognize keeps its watcher rather than silently losing live
/// discovery.
const TERMINAL_STATUSES: &[&str] = &["exited", "lost", "terminated", "failed"];

/// Scopes whose documents belong to a module's scratch workspace rather than to
/// a Work Item.
const SCRATCH_SCOPES: &[&str] = &["plan", "instant"];

/// One run a watcher may be started for.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WatchTarget {
    pub(crate) agent_run_id: String,
    /// The already-authorized design directory recorded on the run. It is
    /// never taken from a caller, and never composed here.
    pub(crate) design_dir: String,
    pub(crate) identity: RegistrationIdentity,
}

/// Every active durable run with an existing authorized design directory.
pub(crate) async fn eligible_targets(
    database: &DatabaseConnection,
) -> Result<Vec<WatchTarget>, DocumentsError> {
    let rows = agent_run::Entity::find()
        .filter(agent_run::Column::DesignDir.is_not_null())
        .filter(agent_run::Column::Status.is_not_in(TERMINAL_STATUSES.iter().copied()))
        .all(database)
        .await?;
    let mut targets = Vec::new();
    for row in rows {
        let Some(design_dir) = row.design_dir.clone() else {
            continue;
        };
        // A recorded directory that is not there is not watchable. It becomes
        // eligible again the moment it exists, because eligibility is re-read
        // rather than remembered.
        if !std::path::Path::new(&design_dir).is_dir() {
            continue;
        }
        let Some(identity) = registration_identity(database, &row).await? else {
            continue;
        };
        targets.push(WatchTarget {
            agent_run_id: row.id.clone(),
            // The one spelling the registry keys rows by. A run records
            // whichever spelling launched it, and registering under that one
            // would duplicate every document the canonical rescan already
            // registered under the resolved design directory.
            design_dir: crate::documents::canonical_root(&design_dir),
            identity,
        });
    }
    Ok(targets)
}

/// The bucket a run's discovered documents are registered into.
///
/// A planning or instant run writes into its module's scratch workspace; a task
/// run writes into its own Work Item's registry. Both are derived from the run
/// row and the Work Item graph, so a watcher cannot register documents against
/// a bucket the run does not belong to.
async fn registration_identity(
    database: &DatabaseConnection,
    run: &agent_run::Model,
) -> Result<Option<RegistrationIdentity>, DocumentsError> {
    use ticketry_entities::work_management::issue;

    let Some(owner) = issue::Entity::find_by_id(run.issue_id.clone())
        .one(database)
        .await?
    else {
        return Ok(None);
    };
    let scratch = SCRATCH_SCOPES.contains(&run.scope.as_str());
    // A scratch run bound to the module itself owns that module's bucket; one
    // bound to a Work Item borrows the module that Work Item sits in.
    let module_id = if scratch && owner.module_id.is_none() {
        owner.id.clone()
    } else {
        owner.module_id.clone().unwrap_or_else(|| owner.id.clone())
    };
    Ok(Some(RegistrationIdentity {
        module_id: hyphenated(&module_id),
        task_id: if scratch {
            SCRATCH_TASK_ID.to_owned()
        } else {
            hyphenated(&owner.id)
        },
        scope: if scratch {
            run.scope.clone()
        } else {
            "task".to_owned()
        },
        discovered_by_run_id: Some(run.id.clone()),
    }))
}

fn hyphenated(identity: &str) -> String {
    uuid::Uuid::parse_str(identity)
        .map(|value| value.hyphenated().to_string())
        .unwrap_or_else(|_| identity.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_recorded_terminal_statuses_end_a_watch() {
        assert!(TERMINAL_STATUSES.contains(&"exited"));
        assert!(TERMINAL_STATUSES.contains(&"terminated"));
        assert!(TERMINAL_STATUSES.contains(&"failed"));
        assert!(TERMINAL_STATUSES.contains(&"lost"));
        assert!(!TERMINAL_STATUSES.contains(&"running"));
    }
}
