//! External callers use approved root capabilities after facade contraction.
#[allow(unused_imports)]
use ticketry_workspace_runtime::{
    adopt_workspace, adopt_worktrees, apply_worktree_column_policy, canonical_uuid, compact_uuid,
    install_pull_request_url_migration, install_ship_record_migration,
    install_workspace_operations, module_folder, owned_tables, preflight, publish_readiness,
    published_readiness_is_complete, register_design_document_graphql,
    register_directory_completion_graphql, register_workspace_worktree_graphql,
    register_worktree_changes_graphql, register_worktree_persistence_graphql,
    register_worktree_status_graphql, resolve_worktree_owner, staging_file_name, validate_schema,
    verify_workspace_operations, worktrees_adopted, AdoptionEvidence, ChangedFile,
    ClaimedOperation, CleanupProgress, CurrentWorktreeView, DocumentSaveError,
    DocumentSaveErrorCode, DocumentSaveOutcome, DocumentSaveService, ExternalObservation,
    FileDiffView, GitOutcome, GitPort, HandoffEvidence, LaunchedAgent, LocalMergeDestinationView,
    MergePreparationError, MergePreparationLauncher, MergePreparationResult,
    MergePreparationService, ModuleCheckoutChangesView, ModuleVersionControlView, NormalizedIntent,
    OperationSubject, PreparedOperation, PullRequestCreationResult, PullRequestStatusView,
    ReconciledOperation, ReconciliationDecision, ReconciliationReport, RepositoryCommandResult,
    RepositoryLocks, ResourceIdentity, RunOptions, SettledOperation, Settlement,
    ShipRecordReadScope, Slice4Readiness, SourceClassification, WorkItemClosureFailureView,
    WorkspaceHandoffError, WorkspaceHandoffErrorCode, WorkspaceOperationError,
    WorkspaceOperationErrorCode, WorkspaceOperationExecutor, WorkspaceOperationIntent,
    WorkspaceOperationJournal, WorkspaceOperationKind, WorkspaceOperationOutcome,
    WorkspaceOperationReconciler, WorkspaceOperationRecord, WorkspaceReadinessGate,
    WorkspaceResourceKind, WorkspaceStateProbe, WorktreeChangesError, WorktreeChangesService,
    WorktreeChangesView, WorktreeCleanupStatusView, WorktreeCreateError, WorktreeCreateErrorCode,
    WorktreeCreateService, WorktreeDiscardError, WorktreeDiscardErrorCode, WorktreeDiscardResult,
    WorktreeDiscardService, WorktreeMergePath, WorktreeMergePreviewView, WorktreeMergeResult,
    WorktreeOperations, WorktreeOwner, WorktreePersistenceError, WorktreePersistenceErrorCode,
    WorktreeStatusError, WorktreeStatusErrorCode, WorktreeStatusService, WorktreeStatusView,
    GENERATED_MUTATION_GAPS, LEDGER_TABLE, PROTECTED_COLUMNS, PULL_REQUEST_URL_LEDGER_TABLE,
    PULL_REQUEST_URL_MIGRATION_ID, REDACTED, SHIP_RECORD_LEDGER_TABLE, SHIP_RECORD_MIGRATION_ID,
    STAGING_PREFIX, VERSION,
};

async fn owner_lookup(
    database: &sea_orm::DatabaseConnection,
) -> Result<WorktreeOwner, WorktreeStatusError> {
    resolve_worktree_owner(database, "00000000-0000-0000-0000-0000000002c1").await
}

#[test]
fn external_callers_can_name_workspace_capabilities_without_implementation_paths() {
    let _ = (
        install_workspace_operations,
        module_folder,
        owner_lookup,
        register_design_document_graphql,
        register_directory_completion_graphql,
        register_worktree_changes_graphql,
        register_worktree_persistence_graphql,
        register_worktree_status_graphql,
        register_workspace_worktree_graphql,
    );
    let _: Option<(
        DocumentSaveService,
        WorktreeChangesService,
        WorktreeCreateService,
        WorktreeDiscardService,
        WorktreeOperations,
        WorktreeStatusService,
        WorkspaceOperationJournal,
        Box<dyn MergePreparationLauncher>,
    )> = None;

    assert_eq!(
        compact_uuid("00000000-0000-0000-0000-0000000002c1"),
        "000000000000000000000000000002c1"
    );
    assert_eq!(
        canonical_uuid("000000000000000000000000000002c1"),
        "00000000-0000-0000-0000-0000000002c1"
    );
}
