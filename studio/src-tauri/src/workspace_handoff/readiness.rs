//! One versioned readiness result for the complete Slice 4 workspace runtime.
//!
//! The gate composes everything the cutover made Rust responsible for: the two
//! schema adoptions, the validated one-writer assignment, the durable status
//! outbox the facts are appended to, one bounded Workspace Operation
//! reconciliation pass, the authorized document roots, the GraphQL surface, the
//! desktop asset protocol, and the watcher supervisor.
//!
//! It is deliberately all-or-nothing. A partially ready runtime answers a
//! structured unavailable error; it never degrades to a second writer, and
//! after the handoff there is no Django writer left to degrade to.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::manifest::VERSION;
use super::{WorkspaceHandoffError, WorkspaceHandoffErrorCode};

pub const READINESS_FILE: &str = "slice4-readiness.json";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Slice4Readiness {
    pub version: i32,
    /// `design_documents` was adopted in place and its ledger is installed.
    pub documents_ownership: bool,
    /// `worktrees` was adopted in place and its ledger is installed.
    pub worktree_ownership: bool,
    /// The Workspace Operation journal is installed at the owned shape.
    pub operation_journal_ownership: bool,
    /// Exactly one production writer owns every transferred table, and the live
    /// schema matches the shape this build owns.
    pub ownership_validated: bool,
    /// The durable status outbox document and worktree facts are appended to.
    pub status_outbox: bool,
    /// One bounded reconciliation pass over prepared and abandoned operations
    /// completed before any window could ask for a document or a checkout.
    pub operation_reconciliation: bool,
    /// The authorized design-document roots resolved from the selected profile.
    pub authorized_roots: bool,
    /// The document and worktree GraphQL surfaces are registered.
    pub graphql_workspace: bool,
    /// The read-only desktop document protocol is registered.
    pub asset_protocol: bool,
    /// The document watcher supervisor started and reconstructed its watchers.
    pub document_watch: bool,
    pub ready: bool,
    /// Always false. It exists so the published record states, rather than
    /// merely implies, that no Django document or worktree writer remains.
    pub django_write_fallback: bool,
}

impl Slice4Readiness {
    pub fn unavailable() -> Self {
        Self {
            version: VERSION,
            documents_ownership: false,
            worktree_ownership: false,
            operation_journal_ownership: false,
            ownership_validated: false,
            status_outbox: false,
            operation_reconciliation: false,
            authorized_roots: false,
            graphql_workspace: false,
            asset_protocol: false,
            document_watch: false,
            ready: false,
            django_write_fallback: false,
        }
    }

    pub fn complete() -> Self {
        Self {
            version: VERSION,
            documents_ownership: true,
            worktree_ownership: true,
            operation_journal_ownership: true,
            ownership_validated: true,
            status_outbox: true,
            operation_reconciliation: true,
            authorized_roots: true,
            graphql_workspace: true,
            asset_protocol: true,
            document_watch: true,
            ready: true,
            django_write_fallback: false,
        }
    }

    pub fn validate(&self) -> Result<(), WorkspaceHandoffError> {
        if self.version != VERSION {
            return Err(unknown(format!(
                "unknown Slice 4 readiness version {}",
                self.version
            )));
        }
        let complete = self.documents_ownership
            && self.worktree_ownership
            && self.operation_journal_ownership
            && self.ownership_validated
            && self.status_outbox
            && self.operation_reconciliation
            && self.authorized_roots
            && self.graphql_workspace
            && self.asset_protocol
            && self.document_watch
            && !self.django_write_fallback;
        if self.ready != complete {
            return Err(unknown(
                "partial Slice 4 readiness cannot serve document or worktree commands",
            ));
        }
        Ok(())
    }
}

pub fn publish(
    data_directory: &Path,
    readiness: &Slice4Readiness,
) -> Result<(), WorkspaceHandoffError> {
    readiness.validate()?;
    let destination = data_directory.join(READINESS_FILE);
    let temporary = data_directory.join(format!(".{READINESS_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let encoded = serde_json::to_vec_pretty(readiness)
        .map_err(|error| unavailable(format!("could not encode Slice 4 readiness: {error}")))?;
    std::fs::write(&temporary, &encoded).map_err(io_error)?;
    std::fs::rename(&temporary, &destination).map_err(io_error)
}

/// Whether the exact complete result is published. Anything else — missing,
/// malformed, unknown field, partial, or a stale record from an older build —
/// keeps the gate closed.
pub fn published_readiness_is_complete(data_directory: &Path) -> bool {
    let Ok(contents) = std::fs::read(data_directory.join(READINESS_FILE)) else {
        return false;
    };
    let Ok(readiness) = serde_json::from_slice::<Slice4Readiness>(&contents) else {
        return false;
    };
    readiness == Slice4Readiness::complete() && readiness.validate().is_ok()
}

fn io_error(source: std::io::Error) -> WorkspaceHandoffError {
    unavailable(format!("Slice 4 readiness file operation failed: {source}"))
}
fn unavailable(message: impl Into<String>) -> WorkspaceHandoffError {
    WorkspaceHandoffError::new(WorkspaceHandoffErrorCode::ReadinessUnavailable, message)
}
fn unknown(message: impl Into<String>) -> WorkspaceHandoffError {
    WorkspaceHandoffError::new(WorkspaceHandoffErrorCode::UnknownSchema, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every field is load-bearing: closing any one of them must close the gate.
    /// The list is derived from the record itself so a field added later cannot
    /// be silently excluded from the composition.
    fn closers() -> Vec<fn(&mut Slice4Readiness)> {
        vec![
            |readiness| readiness.documents_ownership = false,
            |readiness| readiness.worktree_ownership = false,
            |readiness| readiness.operation_journal_ownership = false,
            |readiness| readiness.ownership_validated = false,
            |readiness| readiness.status_outbox = false,
            |readiness| readiness.operation_reconciliation = false,
            |readiness| readiness.authorized_roots = false,
            |readiness| readiness.graphql_workspace = false,
            |readiness| readiness.asset_protocol = false,
            |readiness| readiness.document_watch = false,
            |readiness| readiness.django_write_fallback = true,
        ]
    }

    #[test]
    fn a_partial_result_cannot_claim_readiness() {
        for close in closers() {
            let mut readiness = Slice4Readiness::complete();
            close(&mut readiness);
            assert!(readiness.validate().is_err());
        }
    }

    #[test]
    fn the_composition_covers_every_gate_the_record_declares() {
        // One closer per boolean gate, plus the fallback assertion, plus the
        // `ready` and `version` fields the closers deliberately leave alone.
        let declared = serde_json::to_value(Slice4Readiness::complete())
            .expect("encode readiness")
            .as_object()
            .expect("readiness is an object")
            .len();
        assert_eq!(closers().len() + 2, declared);
    }

    #[test]
    fn an_unknown_version_is_refused() {
        let mut readiness = Slice4Readiness::complete();
        readiness.version = VERSION + 1;
        assert!(readiness.validate().is_err());
    }

    #[test]
    fn the_closed_gate_is_itself_a_valid_result() {
        assert!(Slice4Readiness::unavailable().validate().is_ok());
    }

    #[test]
    fn missing_partial_or_unknown_published_results_keep_the_gate_closed() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        assert!(!published_readiness_is_complete(directory.path()));

        publish(directory.path(), &Slice4Readiness::unavailable())
            .expect("publish the closed gate");
        assert!(!published_readiness_is_complete(directory.path()));

        let mut unknown_field = serde_json::to_value(Slice4Readiness::complete())
            .expect("encode readiness");
        unknown_field
            .as_object_mut()
            .expect("readiness is an object")
            .insert("unknown".to_owned(), serde_json::Value::Bool(true));
        std::fs::write(
            directory.path().join(READINESS_FILE),
            serde_json::to_vec(&unknown_field).expect("encode unknown field"),
        )
        .expect("write a readiness record with an unknown field");
        assert!(!published_readiness_is_complete(directory.path()));

        publish(directory.path(), &Slice4Readiness::complete()).expect("publish readiness");
        assert!(published_readiness_is_complete(directory.path()));
    }

    #[test]
    fn publishing_a_partial_result_is_refused_rather_than_written() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let mut partial = Slice4Readiness::complete();
        partial.operation_reconciliation = false;
        assert!(publish(directory.path(), &partial).is_err());
        assert!(!directory.path().join(READINESS_FILE).exists());
    }
}
