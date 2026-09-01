#![deny(private_bounds, private_interfaces)]

//! Durable Runs history and everything that writes to it.
//!
//! A Run is the record of one agent execution: what was launched, what the
//! provider reported while it worked, and how it settled. The implementation
//! is split into persistence, GraphQL, authority, and hook-spool modules, but
//! this root is the only public boundary.
//!
//! The explicit exports below are intentional seams: GraphQL registration is
//! consumed by the schema crate, hook-spool types are consumed by the desktop
//! runtime, and the persistence/test-support types are consumed by sibling
//! slices and integration tests. The implementation modules stay private so
//! those seams cannot grow by accident.

mod authority;
mod graphql;
mod hook_spool;
mod persistence;

pub use authority::{AuthorizationFailure, RunAuthority, RunPrincipal};
pub use graphql::register_graphql;
pub use hook_spool::{
    ensure_hook_spool_directory, hook_spool_directory, DrainReport, HookDiagnostic,
    HookLifecycleSink, HookSpool, HookSpoolError, HookSpoolRuntime, DEFAULT_BATCH_SIZE,
    MAX_HOOK_BYTES,
};
pub use persistence::timestamp::{format as format_timestamp, normalize as normalize_timestamp};
pub use persistence::{
    adopt, failure_code, open_status_stream, outbox_adopted, owned_run_tables, preflight,
    publish_readiness, published_readiness_is_complete, readiness_open, readiness_unavailable,
    record_run_ended, record_sweep_ended, register_status_graphql, reset_reason, run_holding_in,
    terminating_signal, unavailable_error, AdoptionEvidence, AgentRunHolding, AgentRunRecord,
    AttemptFailure, AttemptOutcome, AttemptService, AutomationAttemptProjection,
    AutomationAttemptRecord, ClaimedLaunch, CompactionOutcome, CompactionPolicy,
    CompactionSchedule, CompatibilityService, DjangoGeneration, EffectService, EndOfLifeOrigin,
    LaunchDispatchService, LaunchEffectRecord, LaunchExecutor, LaunchExecutorFailure, LaunchIntent,
    LaunchOutcome, LaunchPreparationParticipant, LaunchReconciliationService,
    LaunchRuntimeEvidence, LaunchRuntimeProbe, LaunchSettlementParticipant, LifecycleAcceptance,
    LifecycleFact, LifecycleService, NewStatusEvent, OutboxService, PrepareLaunchRequest,
    PreparedLaunch, QueryProjectionService, ReconciledEffect, ReconciliationDecision,
    ReconciliationReport, RecordedLaunch, RunSnapshot, RunStatusCaughtUp, RunStatusEvent,
    RunStatusFailed, RunStatusFrame, RunStatusResetRequired, RunStatusSnapshot,
    RunsPersistenceError, RunsPersistenceErrorCode, RunsReadinessGate, RunsServices,
    RuntimeIdentity, RuntimeObservation, Slice3Readiness, SourceClassification,
    StatusCompactionService, StatusEventPayload, StatusEventRecord, StatusEventRepository,
    StatusStreamRequest, StatusStreamService, TerminalAcceptance, TerminalFact, TerminalOutcome,
    TransitionOccurrence, ADOPTED_TABLES, ATTEMPT_COLUMNS, AUTHORED_TABLES, COMPACTION_BATCH,
    COMPACTION_INTERVAL, CURRENT_DJANGO_LEAF, DJANGO_COMPATIBILITY_PORTS, DJANGO_OWNER_ENV,
    MAX_LEASE_SECONDS, MAX_RECONCILIATION_BATCH, MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS,
    READINESS_FILE, RETAINED_EVENTS, RETENTION_DAYS, RUNTIME_CONFLICT_CODE,
    RUN_OWNED_AUTHORED_TABLES, SUPPORTED_PAYLOAD_VERSION, VERSION,
};
