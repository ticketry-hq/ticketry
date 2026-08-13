//! Migration-safe persistence boundary for durable Runs history.
//!
//! This module is intentionally not installed in desktop startup yet. Django
//! remains the production writer until the Slice 3 handoff; callers may open
//! only explicitly supplied databases for fixture and compatibility work.

mod adoption;
mod attempt_commands;
mod attempt_graphql;
mod attempt_queries;
mod entities;
mod error;
mod intent;
mod lifecycle;
mod lifecycle_graphql;
mod lifecycle_types;
mod mcp;
mod queries;
mod records;
mod repositories;
mod schema;
mod services;
mod termination;
mod timestamp;
mod work_item_scope;

pub use adoption::{adopt, preflight, AdoptionEvidence, DjangoGeneration, SourceClassification};
pub use error::{RunsPersistenceError, RunsPersistenceErrorCode};
pub use intent::LaunchIntent;
pub use lifecycle_types::{
    LifecycleAcceptance, LifecycleFact, TerminalAcceptance, TerminalFact, TerminalOutcome,
};
pub use mcp::McpRunControl;
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
    QueryProjectionService, RunsServices,
};
pub use termination::{
    AuthenticatedAgentRun, RunTerminationService, TerminateRunRequest, TerminationExecutor,
    TerminationExecutorEvidence, TerminationResult,
};

pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    lifecycle_graphql::register(attempt_graphql::register(builder))
}
