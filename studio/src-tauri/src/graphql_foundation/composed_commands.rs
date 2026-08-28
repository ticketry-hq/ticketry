//! The command-side handles composition builds once and callers reuse.
//!
//! Opening `work_management::open_for_commands` again hands back a second
//! SeaORM pool and re-runs the transition-occurrence and launch-policy DDL,
//! each statement taking an exclusive write lock on `state.db`. A second
//! `ProfileStore` is worse than wasteful: its mutation lock is per instance,
//! so two stores over `profiles.json` no longer serialise with each other.
//! Composition therefore publishes what it built instead of letting later
//! callers rebuild it.

use sea_orm::DatabaseConnection;

use crate::documents::watch::DocumentWatchSupervisor;
use crate::documents::DocumentsService;
use crate::settings_persistence::{ProfileStore, SettingsStores};

/// The handles a completed one-writer handoff leaves for the desktop shell.
pub struct AdoptedWorktracker {
    pub runtime: ComposedCommandRuntime,
}

/// What composing the WorktTracker schema produced, beyond the endpoint it
/// installed. The Documents boundary and its watcher supervisor are handed back
/// rather than rebuilt, because a second Documents service would publish facts
/// through a second outbox handle and a second supervisor would run a second
/// watcher for every active run.
pub(crate) struct ComposedWorktracker {
    pub(crate) commands: DatabaseConnection,
    pub(crate) documents: DocumentsService,
    /// Absent when the Documents capability could not be composed at all; a
    /// registry refresh still works, only live discovery is missing.
    pub(crate) document_watch: Option<DocumentWatchSupervisor>,
    /// Whether every startup Workspace Operation reconciliation pass finished.
    /// Deliberately not "the backlog is empty": an ambiguous document or
    /// repository is meant to stay deferred without disabling unrelated ones.
    pub(crate) workspace_reconciled: bool,
    pub(crate) viewer_ownership: crate::viewer_ownership::ViewerOwnershipService,
    pub(crate) terminal_runtime: crate::terminal::lifecycle::InteractiveTerminalLaunchRuntime,
    pub(crate) output_activity: crate::terminal::output_activity::TerminalOutputActivityService,
}

/// The live command connection, profile store, and workspace services held by
/// the installed GraphQL schema.
#[derive(Clone)]
pub struct ComposedCommandRuntime {
    commands: DatabaseConnection,
    profiles: ProfileStore,
    documents: DocumentsService,
    document_watch: Option<DocumentWatchSupervisor>,
    workspace_reconciled: bool,
    viewer_ownership: crate::viewer_ownership::ViewerOwnershipService,
    terminal_runtime: crate::terminal::lifecycle::InteractiveTerminalLaunchRuntime,
    output_activity: crate::terminal::output_activity::TerminalOutputActivityService,
}

impl ComposedCommandRuntime {
    pub(crate) fn new(composed: ComposedWorktracker, settings: &SettingsStores) -> Self {
        Self {
            commands: composed.commands,
            profiles: settings.profiles().clone(),
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

    /// The same store the local-settings GraphQL fields mutate through, so
    /// its mutation lock keeps serialising every writer in this process.
    pub fn profiles(&self) -> &ProfileStore {
        &self.profiles
    }

    pub fn viewer_ownership(&self) -> &crate::viewer_ownership::ViewerOwnershipService {
        &self.viewer_ownership
    }

    pub fn terminal_runtime(&self) -> &crate::terminal::lifecycle::InteractiveTerminalLaunchRuntime {
        &self.terminal_runtime
    }

    pub fn output_activity(
        &self,
    ) -> &crate::terminal::output_activity::TerminalOutputActivityService {
        &self.output_activity
    }
}
