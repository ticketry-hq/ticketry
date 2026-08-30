//! The closed registry of operation kinds.
//!
//! The journal is a rehearsed recovery protocol, not a generic command queue.
//! A kind is what selects typed reconciliation code, so it can never arrive as
//! a free-form string from a caller: an unknown code is refused before any row
//! exists. Adding a kind means adding a typed intent decoder, an authorization
//! resolver, an external probe, an idempotent executor, and its settlement.

use super::{WorkspaceOperationError, WorkspaceOperationErrorCode};

/// Every kind the Workspace Runtime knows how to recover.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[non_exhaustive]
pub enum WorkspaceOperationKind {
    /// Digest-guarded replacement of one registered Markdown document.
    DocumentSave,
    /// Convergence of the document registry against an authorized root.
    DocumentRegistryRefresh,
    /// Creation of one task checkout and its derived branch.
    WorktreeCreate,
    /// Removal of one task checkout, its administrative record, and branch.
    WorktreeDiscard,
}

/// The resource family a kind acts on. Reconciliation isolates an ambiguous
/// resource by this pair, so an undecidable document can never make an
/// unrelated repository unusable.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[non_exhaustive]
pub enum WorkspaceResourceKind {
    Document,
    DocumentRoot,
    Worktree,
}

/// The registry, in one place: code, resource family, and the intent schema
/// versions the current typed decoders accept.
const REGISTRY: &[(WorkspaceOperationKind, &str, WorkspaceResourceKind, &[i32])] = &[
    (
        WorkspaceOperationKind::DocumentSave,
        "document_save",
        WorkspaceResourceKind::Document,
        &[1],
    ),
    (
        WorkspaceOperationKind::DocumentRegistryRefresh,
        "document_registry_refresh",
        WorkspaceResourceKind::DocumentRoot,
        &[1],
    ),
    (
        WorkspaceOperationKind::WorktreeCreate,
        "worktree_create",
        WorkspaceResourceKind::Worktree,
        &[1],
    ),
    (
        WorkspaceOperationKind::WorktreeDiscard,
        "worktree_discard",
        WorkspaceResourceKind::Worktree,
        &[1],
    ),
];

impl WorkspaceOperationKind {
    pub fn code(self) -> &'static str {
        entry(self).1
    }

    pub fn resource_kind(self) -> WorkspaceResourceKind {
        entry(self).2
    }

    /// The intent schema versions the current typed decoder understands.
    pub fn supported_versions(self) -> &'static [i32] {
        entry(self).3
    }

    /// Decode a stored or submitted kind code. An unrecognised code is a typed
    /// refusal, never a row the journal would later have to guess about.
    pub fn from_code(code: &str) -> Result<Self, WorkspaceOperationError> {
        REGISTRY
            .iter()
            .find(|(_, registered, _, _)| *registered == code)
            .map(|(kind, _, _, _)| *kind)
            .ok_or_else(|| {
                WorkspaceOperationError::new(
                    WorkspaceOperationErrorCode::UnsupportedKind,
                    "The Workspace Operation kind is not registered.",
                )
            })
    }

    pub(crate) fn validate_version(self, version: i32) -> Result<(), WorkspaceOperationError> {
        if self.supported_versions().contains(&version) {
            return Ok(());
        }
        Err(WorkspaceOperationError::new(
            WorkspaceOperationErrorCode::UnsupportedVersion,
            "The Workspace Operation intent version is not supported by its kind.",
        ))
    }

    pub fn all() -> impl Iterator<Item = Self> {
        REGISTRY.iter().map(|(kind, _, _, _)| *kind)
    }
}

impl WorkspaceResourceKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::DocumentRoot => "document_root",
            Self::Worktree => "worktree",
        }
    }
}

fn entry(
    kind: WorkspaceOperationKind,
) -> &'static (
    WorkspaceOperationKind,
    &'static str,
    WorkspaceResourceKind,
    &'static [i32],
) {
    REGISTRY
        .iter()
        .find(|(registered, _, _, _)| *registered == kind)
        .expect("every registered kind has one registry entry")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_round_trips_through_its_registered_code() {
        for kind in WorkspaceOperationKind::all() {
            assert_eq!(
                WorkspaceOperationKind::from_code(kind.code()).unwrap(),
                kind
            );
            assert!(!kind.supported_versions().is_empty());
        }
    }

    #[test]
    fn an_unregistered_kind_is_refused_rather_than_decoded() {
        let error = WorkspaceOperationKind::from_code("run_shell_command").unwrap_err();
        assert_eq!(error.code(), WorkspaceOperationErrorCode::UnsupportedKind);
    }

    #[test]
    fn a_malformed_version_is_refused_by_its_kind() {
        for version in [-1, 0, 2, i32::MAX] {
            let error = WorkspaceOperationKind::DocumentSave
                .validate_version(version)
                .unwrap_err();
            assert_eq!(
                error.code(),
                WorkspaceOperationErrorCode::UnsupportedVersion
            );
        }
        assert!(WorkspaceOperationKind::DocumentSave
            .validate_version(1)
            .is_ok());
    }
}
