//! Composing automatic worktree integration beside this listener.
//!
//! Committed workflow transitions are produced here, so the completions they
//! publish are delivered here too — not because integration is an MCP concern,
//! but because this is the process's standing reconciliation loop and a landing
//! should follow a completion by seconds rather than by a restart.
//!
//! Nothing about it is exposed: no tool, no route, no request path. The
//! composition is also allowed to fail. A journal that cannot be installed, or
//! a status outbox this store has not adopted yet, leaves integration
//! uncomposed for this listener rather than landing checkouts whose durable
//! fact could not be published.

use sea_orm::DatabaseConnection;

use crate::settings_persistence::ProfileStore;
use crate::worktree_integrate::WorktreeIntegrateService;

pub(super) async fn compose(
    database: &DatabaseConnection,
    profiles: &ProfileStore,
) -> Option<WorktreeIntegrateService> {
    if let Err(error) = crate::workspace_operations::schema::install(database).await {
        eprintln!("Ticketry could not install the Workspace Operation journal: {error}");
        return None;
    }
    if !crate::runs_persistence::outbox_adopted(database).await {
        eprintln!(
            "Ticketry left worktree integration uncomposed: the status outbox is not available."
        );
        return None;
    }
    Some(WorktreeIntegrateService::new(
        database.clone(),
        profiles.clone(),
        crate::workspace_operations::WorkspaceOperationJournal::new(database.clone()),
        Some(
            crate::runs_persistence::RunsServices::new(database.clone())
                .outbox()
                .events()
                .clone(),
        ),
        // The process-wide locks, so a landing here and a creation composed in
        // the GraphQL schema never touch one repository at the same moment.
        crate::worktree_status::RepositoryLocks::shared(),
    ))
}
