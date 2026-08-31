//! The one idempotent performer of a prepared save.
//!
//! Both paths that can replace a document — a user saving through GraphQL and
//! startup reconciliation draining the journal — run exactly this code under
//! exactly one claim, so there is a single place where the document lock is
//! held, the current version is inspected, the bytes are staged and renamed,
//! and the registry digest, the durable fact, and the operation settle
//! together.
//!
//! Three rules make repetition safe:
//!
//! * **Nothing is derived from the journal.** The intent carries digests and
//!   relative identities only; the authorized root and the target file are
//!   re-resolved from the current registry row and then *compared* with the
//!   intent. A document re-registered under a different root is a conflict,
//!   not a second write.
//! * **The file is read before it is written.** A file already holding the
//!   intended digest is adopted — that is the crash window where the rename
//!   happened but the digest never committed. A file holding anything other
//!   than the expected version is a stale conflict that is never overwritten.
//! * **The database only ever follows the rename.** The digest and its fact
//!   are written inside the operation's settlement transaction, after the
//!   replacement has been proved on disk.

use async_trait::async_trait;
use sea_orm::DatabaseConnection;
use serde_json::json;

use crate::workspace::operations::{
    ClaimedOperation, WorkspaceOperationExecutor, WorkspaceOperationJournal,
    WorkspaceOperationOutcome,
};
use ticketry_documents::registry_facts::DocumentFactRecorder;

use super::document_locks::DocumentLocks;
use super::error::DocumentSaveError;
use super::identity::SaveIntent;
use super::pending_bodies::PendingBodies;
use super::settlement;
use super::staging;
use super::target::{self, SaveTarget};

/// The typed conflict a caller turns back into "your draft is still yours, and
/// here is the version that is actually on disk".
pub(crate) const STALE_CODE: &str = "document_save_stale";

/// Everything a save needs that is not derived per request.
#[derive(Clone)]
pub(crate) struct SaveExecutor {
    database: DatabaseConnection,
    journal: WorkspaceOperationJournal,
    facts: Option<DocumentFactRecorder>,
    bodies: PendingBodies,
    locks: DocumentLocks,
}

impl SaveExecutor {
    pub(crate) fn new(
        database: DatabaseConnection,
        journal: WorkspaceOperationJournal,
        facts: Option<DocumentFactRecorder>,
    ) -> Self {
        Self {
            database,
            journal,
            facts,
            bodies: PendingBodies::default(),
            locks: DocumentLocks::default(),
        }
    }

    pub(crate) fn database(&self) -> &DatabaseConnection {
        &self.database
    }

    pub(crate) fn journal(&self) -> &WorkspaceOperationJournal {
        &self.journal
    }

    pub(crate) fn bodies(&self) -> &PendingBodies {
        &self.bodies
    }

    /// Re-resolve the document a journalled intent describes. A row that is
    /// gone, or one that now describes a different file, is reported rather
    /// than written to.
    pub(crate) async fn retarget(
        &self,
        intent: &SaveIntent,
    ) -> Result<Result<SaveTarget, WorkspaceOperationOutcome>, DocumentSaveError> {
        let Some(target) = target::resolve(&self.database, &intent.document_id).await? else {
            return Ok(Err(conflicted(
                "document_save_document_absent",
                "This document is no longer a registered, readable Markdown file.",
                json!({ "documentId": intent.document_id, "relPath": intent.rel_path }),
            )));
        };
        if target.row.rel_path != intent.rel_path || target.root_digest != intent.root_digest {
            return Ok(Err(conflicted(
                "document_save_registration_changed",
                "This document now names a different file than the prepared save intended.",
                json!({
                    "intendedRelPath": intent.rel_path,
                    "registeredRelPath": target.row.rel_path,
                    "rootMatches": target.root_digest == intent.root_digest,
                }),
            )));
        }
        Ok(Ok(target))
    }

    /// Perform one claimed save, from the document lock through settlement.
    pub(crate) async fn perform(&self, claim: &ClaimedOperation) -> WorkspaceOperationOutcome {
        let Some(intent) = SaveIntent::decode(&claim.payload) else {
            return WorkspaceOperationOutcome::Failed {
                code: "document_save_intent_undecodable".to_owned(),
                message: "The prepared save intent cannot be decoded by this build.".to_owned(),
                retryable: false,
                cleanup_confirmed: true,
            };
        };
        // One document at a time; unrelated documents stay writable. No
        // database transaction is open across the filesystem work below.
        let _guard = self.locks.acquire(&intent.document_id).await;
        let target = match self.retarget(&intent).await {
            Ok(Ok(target)) => target,
            Ok(Err(outcome)) => return self.settled(claim, outcome).await,
            Err(error) => {
                return self
                    .settled(claim, retryable(error.code_str(), error.to_string()))
                    .await
            }
        };
        let outcome = self.converge(claim, &intent, &target).await;
        // Whatever this attempt decided, a staging file left by an operation
        // that owes nothing is removed. Nothing else in the directory is.
        self.sweep_staging(&target).await;
        outcome
    }

    /// Bring the file and the registry to the intended version, or explain why
    /// they cannot be.
    async fn converge(
        &self,
        claim: &ClaimedOperation,
        intent: &SaveIntent,
        target: &SaveTarget,
    ) -> WorkspaceOperationOutcome {
        let Some(current) = target::current_digest(target) else {
            return self
                .settled(
                    claim,
                    retryable(
                        "document_save_unreadable",
                        "The document could not be read before saving.",
                    ),
                )
                .await;
        };
        let staged = staging::staging_path(&target.directory(), &claim.operation_id);

        // The rename already happened and only its bookkeeping was lost. The
        // file is adopted rather than written a second time.
        if current == intent.intended_digest {
            staging::discard(&staged);
            return self.settle_saved(claim, intent, target, true).await;
        }
        if current != intent.expected_digest {
            return self
                .settled(
                    claim,
                    conflicted(
                        STALE_CODE,
                        "This document changed on disk before the save was applied.",
                        json!({
                            "currentDigest": current,
                            "expectedDigest": intent.expected_digest,
                            "intendedDigest": intent.intended_digest,
                        }),
                    ),
                )
                .await;
        }

        // The expected version is still on disk, so this save may apply. Its
        // bytes come from an intact staged file — the only thing that survives
        // a restart — or from the request that is still in flight.
        if staging::staged_digest(&staged).as_deref() != Some(intent.intended_digest.as_str()) {
            staging::discard(&staged);
            let Some(bytes) = self.bodies.get(&claim.operation_id) else {
                return self
                    .settled(
                        claim,
                        WorkspaceOperationOutcome::Failed {
                            code: "document_save_bytes_unavailable".to_owned(),
                            message:
                                "The intended document version did not survive; the file is unchanged."
                                    .to_owned(),
                            retryable: false,
                            cleanup_confirmed: true,
                        },
                    )
                    .await;
            };
            if let Err(error) = staging::stage(&staged, &bytes) {
                staging::discard(&staged);
                return self
                    .settled(claim, write_failed("document_save_stage_failed", &error))
                    .await;
            }
        }
        if let Err(error) = staging::commit(&staged, &target.path) {
            // The rename refused, so the staged file may still exist. It is
            // this operation's own file, so removing it is not a guess.
            staging::discard(&staged);
            return self
                .settled(claim, write_failed("document_save_replace_failed", &error))
                .await;
        }
        match target::current_digest(target) {
            Some(digest) if digest == intent.intended_digest => {
                self.settle_saved(claim, intent, target, false).await
            }
            _ => {
                self.settled(
                    claim,
                    retryable(
                        "document_save_unverified",
                        "The replaced document could not be proved before recording it.",
                    ),
                )
                .await
            }
        }
    }

    /// Settle a proved replacement together with its registry digest and its
    /// durable fact.
    async fn settle_saved(
        &self,
        claim: &ClaimedOperation,
        intent: &SaveIntent,
        target: &SaveTarget,
        adopted: bool,
    ) -> WorkspaceOperationOutcome {
        let outcome = WorkspaceOperationOutcome::Applied {
            result: settlement::result(intent),
            evidence: json!({
                "adopted": adopted,
                "relPath": target.row.rel_path,
                "digest": intent.intended_digest,
                "replacedDigest": intent.expected_digest,
            }),
        };
        let facts = self.facts.clone();
        let written = self
            .journal
            .settle_with(
                &claim.operation_id,
                &claim.lease_owner,
                outcome.clone(),
                |transaction| {
                    let target = target.clone();
                    let digest = intent.intended_digest.clone();
                    let facts = facts.clone();
                    Box::pin(async move {
                        settlement::commit(transaction, facts.as_ref(), &target, &digest)
                            .await
                            .map(|_| ())
                            .map_err(settlement_failure)
                    })
                },
            )
            .await;
        match written {
            Ok(_) => {
                if let Some(facts) = &self.facts {
                    // Waking subscribers happens only after the transaction
                    // committed, so nothing is published that did not commit.
                    facts.wake();
                }
                outcome
            }
            Err(error) => WorkspaceOperationOutcome::Failed {
                code: error.code_str().to_owned(),
                message: error.to_string(),
                // The file is real and proved; only its bookkeeping failed, so
                // the next attempt adopts rather than rewrites.
                retryable: true,
                cleanup_confirmed: true,
            },
        }
    }

    /// Settle an outcome that owns no model write of its own.
    async fn settled(
        &self,
        claim: &ClaimedOperation,
        outcome: WorkspaceOperationOutcome,
    ) -> WorkspaceOperationOutcome {
        match self
            .journal
            .settle(&claim.operation_id, &claim.lease_owner, outcome.clone())
            .await
        {
            Ok(_) => outcome,
            Err(error) => WorkspaceOperationOutcome::Failed {
                code: error.code_str().to_owned(),
                message: error.to_string(),
                retryable: true,
                cleanup_confirmed: true,
            },
        }
    }

    /// Remove the staging files in one authorized directory that no open
    /// operation still owns.
    ///
    /// Cleanup is deliberately conservative in three ways: only files whose
    /// name Ticketry itself wrote are candidates, an operation the journal
    /// still owes an answer for keeps its file, and an unreadable journal
    /// removes nothing at all.
    async fn sweep_staging(&self, target: &SaveTarget) {
        for (path, operation_id) in staging::staging_files(&target.directory()) {
            match self.journal.find(&operation_id).await {
                // A finished or entirely unknown operation owns nothing.
                Ok(Some(operation)) if operation.is_terminal() => staging::discard(&path),
                Ok(None) => staging::discard(&path),
                _ => {}
            }
        }
    }
}

/// The executor the journal's reconciler drives. It performs exactly what an
/// interactive save performs.
#[async_trait]
impl WorkspaceOperationExecutor for SaveExecutor {
    async fn execute(&self, claim: ClaimedOperation) -> WorkspaceOperationOutcome {
        self.perform(&claim).await
    }
}

fn conflicted(code: &str, message: &str, evidence: serde_json::Value) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Conflicted {
        code: code.to_owned(),
        message: message.to_owned(),
        evidence,
    }
}

fn retryable(code: &str, message: impl Into<String>) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: code.to_owned(),
        message: message.into(),
        retryable: true,
        // Nothing external was attempted on this path, so there is nothing
        // that could survive it.
        cleanup_confirmed: true,
    }
}

/// A refused staging write or rename. The staged file was removed, so the same
/// intent may be attempted again under the same identity — but only while this
/// process still holds the bytes.
fn write_failed(code: &str, error: &std::io::Error) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: code.to_owned(),
        message: crate::workspace::operations::redact_diagnostic(&error.to_string()),
        retryable: true,
        cleanup_confirmed: true,
    }
}

fn settlement_failure(
    error: DocumentSaveError,
) -> crate::workspace::operations::WorkspaceOperationError {
    crate::workspace::operations::WorkspaceOperationError::settlement(error.to_string())
}
