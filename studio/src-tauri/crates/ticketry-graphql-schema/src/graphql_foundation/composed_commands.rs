//! The command-side handles composition builds once and callers reuse.
//!
//! Opening `work_management::open_for_commands` again hands back a second
//! SeaORM pool and re-runs the transition-occurrence and launch-policy DDL,
//! each statement taking an exclusive write lock on `state.db`. Composition
//! therefore publishes what it built instead of letting later callers rebuild
//! it.

use sea_orm::DatabaseConnection;

use ticketry_documents::watch::DocumentWatchSupervisor;
use ticketry_documents::DocumentsService;

/// The handles a completed one-writer handoff leaves for the desktop shell.
pub struct AdoptedWorktracker {
    pub runtime: ComposedCommandRuntime,
}

/// What composing the WorktTracker schema produced, beyond the endpoint it
/// installed. The Documents boundary and its watcher supervisor are handed back
/// rather than rebuilt, because a second Documents service would publish facts
/// through a second outbox handle and a second supervisor would run a second
/// watcher for every active run.
pub struct ComposedWorktracker {
    pub commands: DatabaseConnection,
    pub documents: DocumentsService,
    /// Absent when the Documents capability could not be composed at all; a
    /// registry refresh still works, only live discovery is missing.
    pub document_watch: Option<DocumentWatchSupervisor>,
    /// Whether every startup Workspace Operation reconciliation pass finished.
    /// Deliberately not "the backlog is empty": an ambiguous document or
    /// repository is meant to stay deferred without disabling unrelated ones.
    pub workspace_reconciled: bool,
    pub viewer_ownership: ticketry_terminal::viewer_ownership::ViewerOwnershipService,
    pub terminal_runtime: ticketry_terminal::terminal::lifecycle::InteractiveTerminalLaunchRuntime,
    pub output_activity:
        ticketry_terminal::terminal::output_activity::TerminalOutputActivityService,
}

/// The live command connection and workspace services held by the installed
/// GraphQL schema.
#[derive(Clone)]
pub struct ComposedCommandRuntime {
    commands: DatabaseConnection,
    documents: DocumentsService,
    document_watch: Option<DocumentWatchSupervisor>,
    workspace_reconciled: bool,
    viewer_ownership: ticketry_terminal::viewer_ownership::ViewerOwnershipService,
    terminal_runtime: ticketry_terminal::terminal::lifecycle::InteractiveTerminalLaunchRuntime,
    output_activity: ticketry_terminal::terminal::output_activity::TerminalOutputActivityService,
}

impl ComposedCommandRuntime {
    pub fn new(composed: ComposedWorktracker) -> Self {
        Self {
            commands: composed.commands,
            documents: composed.documents,
            document_watch: composed.document_watch,
            workspace_reconciled: composed.workspace_reconciled,
            viewer_ownership: composed.viewer_ownership,
            terminal_runtime: composed.terminal_runtime,
            output_activity: composed.output_activity,
        }
    }

    /// Whether the initial bounded Workspace Operation reconciliation pass ran
    /// to completion for saves, creations, discards, and integrations.
    pub fn workspace_reconciled(&self) -> bool {
        self.workspace_reconciled
    }

    /// The same Documents boundary GraphQL reads and writes the registry
    /// through, including its durable publisher.
    pub fn documents(&self) -> &DocumentsService {
        &self.documents
    }

    /// The live document watchers, where the capability composed them.
    pub fn document_watch(&self) -> Option<&DocumentWatchSupervisor> {
        self.document_watch.as_ref()
    }

    /// The same pool the authored GraphQL commands write through.
    pub fn commands(&self) -> &DatabaseConnection {
        &self.commands
    }

    pub fn viewer_ownership(&self) -> &ticketry_terminal::viewer_ownership::ViewerOwnershipService {
        &self.viewer_ownership
    }

    pub fn terminal_runtime(
        &self,
    ) -> &ticketry_terminal::terminal::lifecycle::InteractiveTerminalLaunchRuntime {
        &self.terminal_runtime
    }

    pub fn output_activity(
        &self,
    ) -> &ticketry_terminal::terminal::output_activity::TerminalOutputActivityService {
        &self.output_activity
    }
}
