//! Migration-safe persistence boundary for durable Runs history.
//!
//! `RunsServices` is installed in the live GraphQL schema, so Agent Run
//! holdings and lifecycle ingress are authoritative Rust paths. Run-scoped
//! termination is owned by `terminal_cleanup`, while Runs supplies the Agent
//! Run outcome and durable status transaction used at settlement. Launches
//! reach their executor as a `LaunchExecutor`, which
//! performs one already-durable effect and reports a typed outcome without
//! ever writing a Runs table. Effects that outlive a crash are drained by
//! reconciliation, which observes the deterministic runtime identity through a
//! read-only `LaunchRuntimeProbe` before it adopts, executes, fails, or keeps
//! cleaning up. Callers may open only explicitly supplied databases.

mod adoption;
mod attempt_commands;
mod attempt_delivery;
mod attempt_queries;
use ticketry_entities as entities;
mod delivery_mode;
mod end_of_life;
mod error;
mod intent;
mod launch_claim;
mod launch_cleanup;
mod launch_defer;
mod launch_dispatch;
mod launch_executor;
mod launch_outcome;
mod launch_preparation;
mod launch_probe;
mod launch_reconciliation;
mod launch_scan;
mod lifecycle;
mod lifecycle_types;
mod ownership_manifest;
mod queries;
mod readiness;
mod readiness_gate;
mod records;
mod repositories;
mod schema;
mod services;
mod status_compaction;
mod status_compaction_schedule;
mod status_frames;
mod status_stream;
mod status_subscription;
mod status_wakeup;
pub(crate) mod timestamp;
mod work_item_scope;

pub use adoption::{
    adopt, outbox_adopted, preflight, AdoptionEvidence, DjangoGeneration, SourceClassification,
};
pub use delivery_mode::DeliveryMode;
pub use end_of_life::{record_run_ended, record_sweep_ended, terminating_signal, EndOfLifeOrigin};
pub use error::{RunsPersistenceError, RunsPersistenceErrorCode};
pub use intent::LaunchIntent;
pub use launch_claim::{ClaimedLaunch, MAX_LEASE_SECONDS};
pub use launch_dispatch::LaunchDispatchService;
pub use launch_executor::{LaunchExecutor, LaunchExecutorFailure, LaunchRuntimeEvidence};
pub use launch_outcome::LaunchSettlementParticipant;
pub use launch_outcome::{LaunchOutcome, RecordedLaunch};
pub use launch_preparation::LaunchPreparationParticipant;
pub use launch_preparation::{PrepareLaunchRequest, PreparedLaunch, RunSnapshot};
pub use launch_probe::{LaunchRuntimeProbe, RuntimeIdentity, RuntimeObservation};
pub use launch_reconciliation::{
    LaunchReconciliationService, ReconciledEffect, ReconciliationDecision, ReconciliationReport,
    MAX_RECONCILIATION_BATCH, RUNTIME_CONFLICT_CODE,
};
pub use lifecycle_types::{
    LifecycleAcceptance, LifecycleFact, TerminalAcceptance, TerminalFact, TerminalOutcome,
};
pub use ownership_manifest::{
    owned_tables as owned_run_tables, ADOPTED_TABLES, ATTEMPT_COLUMNS,
    AUTHORED_TABLES as RUN_OWNED_AUTHORED_TABLES, DJANGO_COMPATIBILITY_PORTS, DJANGO_OWNER_ENV,
};
pub use queries::run_holding_in;
pub use readiness::{
    publish as publish_readiness, published_readiness_is_complete, unavailable_error,
    Slice3Readiness, READINESS_FILE,
};
pub use readiness_gate::RunsReadinessGate;
pub use records::{
    AgentRunHolding, AgentRunRecord, AttemptFailure, AttemptOutcome, AutomationAttemptProjection,
    AutomationAttemptRecord, LaunchEffectRecord, StatusEventRecord, TransitionOccurrence,
};
pub use repositories::{
    AgentRunRepository, AutomationAttemptRepository, CompactionWatermarkRepository,
    LaunchEffectRepository, NewStatusEvent, StatusEventRepository,
};
pub use schema::{AUTHORED_TABLES, CURRENT_DJANGO_LEAF, VERSION};
pub use services::{
    AttemptService, CompatibilityService, EffectService, LifecycleService, OutboxService,
    QueryProjectionService, RunsServices, StatusStreamService,
};
pub use status_compaction::{
    CompactionOutcome, CompactionPolicy, StatusCompactionService, COMPACTION_BATCH,
    RETAINED_EVENTS, RETENTION_DAYS,
};
pub use status_compaction_schedule::{CompactionSchedule, COMPACTION_INTERVAL};
pub use status_frames::{
    failure_code, reset_reason, RunStatusCaughtUp, RunStatusEvent, RunStatusFailed, RunStatusFrame,
    RunStatusResetRequired, RunStatusSnapshot, StatusEventPayload, SUPPORTED_PAYLOAD_VERSION,
};
pub use status_stream::{StatusStreamRequest, MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS};

pub fn register_status_graphql(builder: seaography::Builder) -> seaography::Builder {
    status_subscription::register(builder)
}

pub fn readiness_open(ctx: &seaography::async_graphql::Context<'_>) -> bool {
    readiness_gate::open(ctx)
}

pub fn readiness_unavailable() -> seaography::async_graphql::Error {
    readiness_gate::unavailable()
}

/// Open the project status stream directly. Tests and supported in-process
/// callers use this seam so the connection ordering is exercised without a
/// GraphQL document in the way.
pub fn open_status_stream(
    service: &StatusStreamService,
    request: StatusStreamRequest,
) -> impl futures_util::Stream<Item = RunStatusFrame> + Send + 'static {
    status_stream::open(service.clone(), request)
}
