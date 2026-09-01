//! The durable bridge between a SQLite transaction and a local filesystem or
//! Git effect.
//!
//! SQLite and the world outside it cannot commit together. A process can stop
//! after replacing a document but before recording its digest, or after Git
//! created a checkout but before its row exists. Retrying blindly can
//! duplicate an effect or destroy evidence; trusting the database alone can
//! strand a real checkout or lose a completed save.
//!
//! A Workspace Operation is the record that closes that gap. It carries a
//! stable identity, immutable versioned intent and its fingerprint, a lease
//! used only for concurrency, sanitized external evidence, and a typed
//! outcome. The protocol is deliberately narrow:
//!
//! 1. **Prepare** commits before the external mutation, so a crash always
//!    leaves a row saying what was intended. Reusing an identity with the same
//!    fingerprint replays its durable result; a different fingerprint is a
//!    typed conflict.
//! 2. **Claim** is a bounded compare-and-set. A lease says only that one
//!    worker is currently acting; its expiry makes the row eligible again and
//!    is never, on its own, permission to act.
//! 3. **Settle** moves the operation to its typed outcome in the same
//!    transaction as the caller's model rows and durable facts.
//! 4. **Reconcile** drains the backlog at startup in bounded, repeatable
//!    passes, always probing external state before retrying, and isolating an
//!    ambiguous resource without blocking unrelated ones.
//!
//! This is a rehearsed recovery protocol, not a generic command queue. Kinds
//! are a closed registry, and the journal refuses to persist file bodies,
//! prompts, credentials, environment values, commands, or caller-selected
//! absolute paths.

use ticketry_entities as entities;

mod checkpoint;
mod claim;
mod cleanup;
mod error;
mod intent;
mod journal;
mod kinds;
pub mod ownership_manifest;
mod prepare;
mod probe;
mod reconciliation;
mod records;
mod sanitize;
mod scan;
pub mod schema;
mod settle;
mod timestamp;

pub use checkpoint::CHECKPOINT_KEY;
pub use claim::{ClaimedOperation, MAX_LEASE_SECONDS};
pub use cleanup::CleanupProgress;
pub use error::{WorkspaceOperationError, WorkspaceOperationErrorCode};
pub use intent::WorkspaceOperationIntent;
pub use journal::WorkspaceOperationJournal;
pub use kinds::{WorkspaceOperationKind, WorkspaceResourceKind};
pub use prepare::PreparedOperation;
pub use probe::{
    ExternalObservation, OperationSubject, WorkspaceOperationExecutor, WorkspaceStateProbe,
};
pub use reconciliation::{
    ReconciledOperation, ReconciliationDecision, ReconciliationReport,
    WorkspaceOperationReconciler, EXTERNAL_CONFLICT_CODE, MAX_RECONCILIATION_BATCH,
};
pub use records::{ResourceIdentity, WorkspaceOperationRecord};
pub use sanitize::REDACTED;
pub use settle::{SettledOperation, Settlement, WorkspaceOperationOutcome};

/// Bound and redact one external diagnostic with the same rule the journal
/// applies to durable evidence. A capability that repeats Git's or the
/// filesystem's own words to a caller uses this, so a message that reaches a
/// user can never be wider than one that reaches the recovery log.
pub fn redact_diagnostic(detail: &str) -> String {
    sanitize::redact_text(detail, 500)
}
