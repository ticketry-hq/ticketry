//! The composed command handles interactive launches reuse.
//!
//! Adoption already opens one writable WorkTracker pool for the installed
//! GraphQL schema. Opening it again per launch click adds
//! a second pool plus a full `CREATE TABLE IF NOT EXISTS` pass, and every one
//! of those DDL statements takes an exclusive write lock on `state.db` that
//! process-local GraphQL, settings, and MCP tasks already share.
//! Composition records what it built here, and the launch command reads it.

use std::sync::OnceLock;

use sea_orm::DatabaseConnection;

use crate::graphql_foundation::ComposedCommandRuntime;
use ticketry_documents::DocumentsService;

/// Managed state for the lifetime of the process. Empty until adoption
/// succeeds; a launch attempted before that is a startup failure, not a
/// reason to open a competing writer.
pub(crate) struct DesktopLaunchRuntime {
    composed: OnceLock<ComposedCommandRuntime>,
}

impl DesktopLaunchRuntime {
    pub(crate) fn new() -> Self {
        Self {
            composed: OnceLock::new(),
        }
    }

    /// Record the handles composition just built. Later adoptions in the same
    /// process keep the first live connection rather than replacing it.
    pub(crate) fn record(&self, runtime: ComposedCommandRuntime) {
        let _ = self.composed.set(runtime);
    }

    pub(crate) fn commands(&self) -> Result<&DatabaseConnection, String> {
        self.composed().map(ComposedCommandRuntime::commands)
    }

    /// The Documents boundary the desktop document protocol serves bytes
    /// through. It is the very service composition installed in the schema, so
    /// protocol reads, GraphQL reads, and the watchers' settlements share one
    /// registry, one authorization boundary, and one durable publisher.
    pub(crate) fn documents(&self) -> Result<DocumentsService, String> {
        self.composed().map(|runtime| runtime.documents().clone())
    }

    pub(crate) fn configure_terminal_authority(
        &self,
        authority: ticketry_terminal::terminal::lifecycle::TerminalRuntimeAuthority,
    ) -> Result<(), String> {
        self.composed()?.terminal_runtime().configure(authority);
        Ok(())
    }

    pub(crate) fn replace_terminal_mcp_authority(
        &self,
        mcp_url: String,
        authority: crate::mcp::RunAuthority,
    ) -> Result<(), String> {
        self.composed()?
            .terminal_runtime()
            .replace_mcp_authority(mcp_url, authority)
    }

    pub(crate) fn viewer_ownership(
        &self,
    ) -> Result<ticketry_terminal::viewer_ownership::ViewerOwnershipService, String> {
        self.composed()
            .map(|runtime| runtime.viewer_ownership().clone())
    }

    pub(crate) fn output_activity(
        &self,
    ) -> Result<ticketry_terminal::terminal::output_activity::TerminalOutputActivityService, String>
    {
        self.composed()
            .map(|runtime| runtime.output_activity().clone())
    }

    /// Stop every live document watcher. Called on application shutdown, so a
    /// finished process leaves no background watch behind.
    pub(crate) fn stop_document_watchers(&self) {
        if let Ok(runtime) = self.composed() {
            if let Some(watchers) = runtime.document_watch() {
                watchers.stop_all();
            }
        }
    }

    /// The whole composed runtime, for the Slice 4 handoff. It needs several
    /// handles at once — the command pool, the Documents boundary, the watcher
    /// supervisor, and the reconciliation outcome — so it reads the composition
    /// rather than adding one accessor per readiness field.
    pub(crate) fn composed_runtime(&self) -> Result<&ComposedCommandRuntime, String> {
        self.composed()
    }

    fn composed(&self) -> Result<&ComposedCommandRuntime, String> {
        self.composed.get().ok_or_else(|| {
            "the composed WorkTracker command runtime is unavailable; \
             Ticketry has not completed its startup handoff"
                .to_owned()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_handles_are_unavailable_until_composition_records_them() {
        let runtime = DesktopLaunchRuntime::new();

        assert!(runtime.commands().is_err());
        assert!(runtime.documents().is_err());
    }
}
