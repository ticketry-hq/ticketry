//! The live terminal a run actually happens in.
//!
//! Everything above this crate decides *what* to launch; this is where a
//! decided launch becomes a real, attached, recoverable process. [`terminal`]
//! is the slice itself: the durable session record and its GraphQL views, the
//! launch boundary that accepts an authorized request and executes it, the
//! lifecycle and reconciliation passes that keep the recorded world equal to
//! the running one across crashes and restarts, resume, output activity,
//! viewer attachment and leases, the instant-run ticket, and cleanup.
//! [`tmux_adapter`] is the one place that knows tmux — session naming,
//! hosted commands, runtime namespaces and the live inventory — so no other
//! module derives a session name for itself. [`viewer_ownership`] arbitrates
//! which viewer holds a session, and [`temporary_profile`] owns the disposable
//! agent profile a run may be given and the journal proving it was discarded.
//!
//! This root is the sole public facade. The explicit exports preserve the
//! terminal integration seam (launch, lifecycle, cleanup, reconciliation,
//! persistence, output, resume, and viewer commands), the GraphQL registration
//! seams, and the audit/test-support records without exposing implementation
//! module paths.

mod temporary_profile;
mod terminal;
mod tmux_adapter;
mod viewer_ownership;

pub use temporary_profile::{
    journal_profile_teardown, journal_terminal_cleanup, ProfileRemoval, ProfileTeardownOutcome,
    TemporaryProfileTeardown, TemporarySqliteProfile, UnresolvedCleanup, TEMP_SQLITE_FLAG,
};
pub use terminal::cleanup::{
    register_graphql as register_cleanup_graphql, AuthenticatedAgentRun,
    CleanupActionCompatibilityStage, CleanupCause, CleanupCheckpoint, CleanupCheckpoints,
    CleanupEffectIdentity, CleanupKillResult, CleanupRuntimeObservation, RuntimeInventory,
    TerminalCleanupError, TerminalCleanupErrorCode, TerminalCleanupRecoveryReport,
    TerminalCleanupRuntime, TerminalCleanupService, TerminationPatch, TmuxCleanupRuntime,
    CLEANUP_ACTION_INPUT_CONTRACT, CLEANUP_ACTION_RESULT_CONTRACT, CLEANUP_ACTION_STAGES,
    CLEANUP_ACTION_VERDICT, DEFAULT_OWNED_ORPHAN_GRACE_SECONDS,
};
pub use terminal::instant_run_ticket::{
    register_graphql as register_instant_run_ticket_graphql, InstantRunTicket,
    InstantRunTicketQuery, INSTANT_RUN_TICKET_LIMIT,
};
pub use terminal::launch::{
    approved_login_shell, register_graphql as register_launch_graphql,
    LaunchActionCompatibilityStage, TerminalLaunchBoundary, TerminalLaunchCheckpoint,
    TerminalLaunchRecoveryReport, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation, VerifiedTerminalRuntime, LAUNCH_ACTION_STAGES,
    LAUNCH_ACTION_VERDICT,
};
pub use terminal::lifecycle::{
    InteractiveTerminalLaunchRuntime, ProductionTerminalLifecycleWork,
    RecoveryTerminalLaunchRuntime, TerminalLifecycleConfig, TerminalLifecycleError,
    TerminalLifecycleRuntime, TerminalLifecycleWork, TerminalRuntimeAuthority,
};
pub use terminal::output_activity::{
    configured_sweep_interval, observe_live_sessions, LiveOutputSweepRuntime,
    TerminalOutputActivityError, TerminalOutputActivityErrorCode, TerminalOutputActivityService,
    TerminalOutputObservation, TerminalScreenCapture, DEFAULT_SWEEP_INTERVAL,
    OUTPUT_SWEEP_INTERVAL_ENV,
};
pub use terminal::persistence::{
    adopt as adopt_terminal_persistence, apply_column_policy as apply_terminal_column_policy,
    owned_tables as owned_terminal_tables, preflight as preflight_terminal_persistence,
    reconciled_handoffs, register_graphql as register_persistence_graphql, terminals_adopted,
    AdoptionEvidence, ChildHandoff, CustomField, CustomFieldKind, HandoffImpact, HandoffStatus,
    PreservationCheck, RawSqlEvidence, RegisteredEntity,
    SourceClassification as TerminalSourceClassification, TableEvidence, TerminalPersistenceError,
    TerminalPersistenceErrorCode, TerminalReadScope, ADOPTED_TABLES as TERMINAL_ADOPTED_TABLES,
    AUDITED_MODULES, CHILD_HANDOFFS, CLEANUP_EFFECT_COLUMNS,
    CURRENT_DJANGO_LEAF as TERMINAL_CURRENT_DJANGO_LEAF, CUSTOM_MUTATIONS, CUSTOM_OUTPUTS,
    CUSTOM_QUERIES, EMPTY_DJANGO_LEAF, GENERATED_MUTATION_GAPS, GENERATED_WRITES,
    LAUNCH_MATERIAL_COLUMNS, LAUNCH_REQUEST_COLUMNS, LEDGER_TABLE, NEEDS_PROOF,
    NON_SEAORM_CRUD_PATHS, OWNERSHIP_AUTHORED_TABLES as TERMINAL_AUTHORED_TABLES,
    RAW_SQL_EVIDENCE_ONLY, REGISTERED_ENTITIES, SESSION_COLUMNS, VERDICT,
    VERSION as TERMINAL_PERSISTENCE_VERSION,
};
/* Keep the persistence version and ownership table names distinct at this
 * facade: the Runs crate has its own migration owner with the same symbols. */
/* The terminal persistence GraphQL registration remains an explicit seam. */
/* The audit and handoff exports are test-support seams, not new runtime APIs. */
/* `VERSION` is intentionally exposed as `TERMINAL_PERSISTENCE_VERSION`. */
/* `SourceClassification` is intentionally exposed with a terminal qualifier. */
/* `RuntimeObservation` is qualified below because launch has a similarly
 * named public observation. */
pub use terminal::reconciliation::{
    NoReconciliationCheckpoints, ReconciledSession, ReconciledUnrecordedRuntime,
    ReconciliationCheckpoint, ReconciliationCheckpoints, RecordedSessionDecision,
    RuntimeConflictDiagnostic, TerminalReconciliationError, TerminalReconciliationErrorCode,
    TerminalReconciliationReport, TerminalReconciliationService, UnrecordedRuntimeDecision,
    MAX_RECORDED_SESSION_BATCH,
};
pub use terminal::resume::{
    register_graphql as register_resume_graphql, validate_resume_request,
    ResumableConversationService, RESUMABLE_LIMIT, RESUMABLE_STATEMENT_LIMIT,
};
pub use terminal::session::register_graphql as register_session_graphql;
pub use terminal::viewer::{
    viewer_attach, viewer_detach, viewer_input, viewer_resize, viewer_scroll, viewer_status,
    ViewerChannelEvent, ViewerCloseReason, ViewerCommandError, ViewerCommandState,
    ViewerFailureCode, ViewerFailureLayer, ViewerLifecycle, ViewerScrollDirection, ViewerStatus,
};
pub use terminal::viewer::{
    AttachmentOutcome, TerminalAttachment, TerminalAttachmentControl, TerminalAttachmentError,
    TerminalCommandAttachment, TerminalCommandAttachmentControl, TerminalScrollDirection,
};
pub use terminal::viewer_lease::register_graphql as register_viewer_lease_graphql;
pub use tmux_adapter::{
    approved_tool_path, current_runtime_namespace, ApprovedArgv, CreateOutcome, CreateSession,
    InventoryConflictKind, InventoryEntry, KillOutcome, OwnedSession, PersistedSessionName,
    RuntimeIdentity as TerminalRuntimeIdentity, RuntimeObservation as TmuxRuntimeObservation,
    ScrollDirection, TerminalGeometry, TmuxAdapter, TmuxAdapterError, MAX_INPUT_BYTES,
    SESSION_PREFIX,
};
pub use viewer_ownership::{
    CreateViewerLease, DeleteViewerLease, PreparedViewerLeaseWrite, PreparedViewerMechanics,
    UpdateViewerLease, ViewerDetachReason, ViewerLeaseModelWrite, ViewerLeaseWritePermit,
    ViewerOwnershipError, ViewerOwnershipErrorCode, ViewerOwnershipService,
};
