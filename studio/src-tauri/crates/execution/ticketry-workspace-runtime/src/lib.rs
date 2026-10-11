#![deny(private_bounds, private_interfaces)]

//! Workspace Runtime: the Git worktrees an agent works in, and the workspace
//! surface built on top of them.
//!
//! [`worktree`] owns the lifecycle of a checkout — creating one for a Module,
//! reading its live Git status, reporting the changes and pull request it
//! carries, and discarding it — together with the adopted persistence tables
//! that make a worktree a durable fact rather than a directory that happens to
//! exist. [`workspace`] is the surface the product presents over those
//! checkouts: the GraphQL views, the journalled operations that mutate them,
//! the document-save path, and the ownership handoff that proves the Rust side
//! owns the tables it writes.
//!
//! The two ship as one crate because the coupling is genuinely mutual: a
//! worktree discard reports its failure as a workspace operation error, and
//! the workspace handoff manifest reads the worktree persistence tables it is
//! accounting for. They are one bounded context, so they are one crate.

mod workspace;
mod worktree;

pub use workspace::design_document::register_graphql as register_design_document_graphql;
pub use workspace::directory_completion_query::register as register_directory_completion_graphql;
pub use workspace::document_save::{
    staging_file_name, DocumentSaveError, DocumentSaveErrorCode, DocumentSaveOutcome,
    DocumentSaveService, STAGING_PREFIX,
};
pub use workspace::handoff::manifest::{owned_tables, validate_schema};
pub use workspace::handoff::{
    adopt as adopt_workspace, publish_readiness, published_readiness_is_complete, HandoffEvidence,
    Slice4Readiness, WorkspaceHandoffError, WorkspaceHandoffErrorCode, WorkspaceReadinessGate,
};
pub use workspace::operations::intent::NormalizedIntent;
pub use workspace::operations::schema::{
    install as install_workspace_operations, verify as verify_workspace_operations,
};
pub use workspace::operations::{
    ClaimedOperation, CleanupProgress, ExternalObservation, OperationSubject, PreparedOperation,
    ReconciledOperation, ReconciliationDecision, ReconciliationReport, ResourceIdentity,
    SettledOperation, Settlement, WorkspaceOperationError, WorkspaceOperationErrorCode,
    WorkspaceOperationExecutor, WorkspaceOperationIntent, WorkspaceOperationJournal,
    WorkspaceOperationKind, WorkspaceOperationOutcome, WorkspaceOperationReconciler,
    WorkspaceOperationRecord, WorkspaceResourceKind, WorkspaceStateProbe, REDACTED,
};
pub use workspace::worktree::register_graphql as register_workspace_worktree_graphql;

pub use worktree::changes::module_view::{
    CurrentWorktreeView, ModuleCheckoutChangesView, ModuleVersionControlView,
};
pub use worktree::changes::{
    register_graphql as register_worktree_changes_graphql, ChangedFile, FileDiffView,
    LaunchedAgent, LocalMergeDestinationView, MergePreparationError, MergePreparationLauncher,
    MergePreparationResult, MergePreparationService, PullRequestCreationResult,
    PullRequestStatusView, RepositoryCommandResult, WorkItemClosureFailureView,
    WorktreeChangesError, WorktreeChangesService, WorktreeChangesView, WorktreeCleanupStatusView,
    WorktreeMergePath, WorktreeMergePreviewView, WorktreeMergeResult,
};
pub use worktree::create::{WorktreeCreateError, WorktreeCreateErrorCode, WorktreeCreateService};
pub use worktree::discard::{
    WorktreeDiscardError, WorktreeDiscardErrorCode, WorktreeDiscardResult, WorktreeDiscardService,
};
pub use worktree::operations::WorktreeOperations;
pub use worktree::persistence::column_policy::apply as apply_worktree_column_policy;
pub use worktree::persistence::ownership_manifest::{GENERATED_MUTATION_GAPS, PROTECTED_COLUMNS};
pub use worktree::persistence::pull_request_url_migration::{
    install as install_pull_request_url_migration, LEDGER_TABLE as PULL_REQUEST_URL_LEDGER_TABLE,
    MIGRATION_ID as PULL_REQUEST_URL_MIGRATION_ID,
};
pub use worktree::persistence::ship_record_migration::{
    install as install_ship_record_migration, LEDGER_TABLE as SHIP_RECORD_LEDGER_TABLE,
    MIGRATION_ID as SHIP_RECORD_MIGRATION_ID,
};
pub use worktree::persistence::{
    adopt as adopt_worktrees, preflight, register_graphql as register_worktree_persistence_graphql,
    worktrees_adopted, AdoptionEvidence, ShipRecordReadScope, SourceClassification,
    WorktreePersistenceError, WorktreePersistenceErrorCode, LEDGER_TABLE, VERSION,
};
pub use worktree::status::identity::{canonical_uuid, compact_uuid};
pub use worktree::status::owner::{resolve as resolve_worktree_owner, WorktreeOwner};
pub use worktree::status::repository::module_folder;
pub use worktree::status::{
    register_graphql as register_worktree_status_graphql, GitOutcome, GitPort, RepositoryLocks,
    RunOptions, WorktreeStatusError, WorktreeStatusErrorCode, WorktreeStatusService,
    WorktreeStatusView,
};
