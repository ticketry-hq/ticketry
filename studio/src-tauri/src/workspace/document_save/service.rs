//! The one place a document save is answered.
//!
//! Studio submits a document identity, the digest it loaded, the bytes it
//! intends, and a stable operation identity, and receives the digest the file
//! now holds. Everything between those two facts — the authorized root, the
//! target file, the durable operation, the staged write, the rename, the
//! registry digest, and the published fact — is derived and performed here.
//!
//! Repetition is ordinary. The same operation identity replays its durable
//! answer instead of writing twice; a save whose file moved on returns the
//! version that is actually on disk so the draft survives and can be applied
//! deliberately; two windows saving the same document serialize and converge
//! on one file version. Reusing an operation identity for *different* bytes is
//! the one repetition that is refused, because rebinding a durable identity
//! would make recovery a guess.

use std::sync::Arc;

use sea_orm::DatabaseConnection;
use seaography::CustomOutputType;
use serde::Serialize;

use crate::workspace::operations::{
    WorkspaceOperationJournal, WorkspaceOperationOutcome, WorkspaceOperationReconciler,
    WorkspaceOperationRecord,
};
use ticketry_documents::asset_access;
use ticketry_documents::registry_facts::DocumentFactRecorder;

use super::error::{DocumentSaveError, DocumentSaveErrorCode};
use super::executor::{SaveExecutor, STALE_CODE};
use super::identity::{self, SaveIntent};
use super::probe::SaveProbe;
use super::target::{self, SaveTarget};

/// A save claim is short. The work it covers is one staged write and one
/// rename, and a worker that dies mid-effect must become eligible again
/// quickly.
const SAVE_LEASE_SECONDS: i64 = 60;

/// The largest document Studio's editor will make durable. It bounds one
/// request, one staged file, and one in-memory hold.
const MAX_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;

/// What one save request is answered with.
///
/// `stale` is not a failure: the draft is still the caller's, and `digest` is
/// the version the file actually holds, so a deliberate retry against it can
/// apply the edit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, CustomOutputType)]
pub struct DocumentSaveOutcome {
    pub document_id: String,
    /// The digest the primary file holds now.
    pub digest: String,
    /// True when the submitted bytes are the version on disk.
    pub saved: bool,
    /// True when the file had already moved on and was left untouched.
    pub stale: bool,
}

#[derive(Clone)]
pub struct DocumentSaveService {
    executor: SaveExecutor,
}

impl DocumentSaveService {
    pub fn new(
        database: DatabaseConnection,
        journal: WorkspaceOperationJournal,
        facts: Option<DocumentFactRecorder>,
    ) -> Self {
        Self {
            executor: SaveExecutor::new(database, journal, facts),
        }
    }

    /// The reconciler that drains abandoned saves at startup. It probes the
    /// document before it acts and executes through the very same executor an
    /// interactive save uses.
    pub fn reconciler(&self) -> WorkspaceOperationReconciler {
        self.executor.journal().reconcile_with(
            Arc::new(SaveProbe::new(self.executor.clone())),
            Arc::new(self.executor.clone()),
        )
    }

    /// Save one registered primary Markdown document against the version the
    /// caller loaded.
    pub async fn save(
        &self,
        document_id: &str,
        expected_digest: &str,
        content: String,
        operation_id: &str,
    ) -> Result<DocumentSaveOutcome, DocumentSaveError> {
        let bytes = Arc::new(content.into_bytes());
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(DocumentSaveError::invalid(
                "The document is larger than Studio will make durable.",
            ));
        }
        let expected_digest = normalized_digest(expected_digest).ok_or_else(|| {
            DocumentSaveError::invalid("The expected document digest is not a content digest.")
        })?;
        let Some(target) = target::resolve(self.executor.database(), document_id).await? else {
            return Err(DocumentSaveError::document_not_found());
        };
        let intent = SaveIntent {
            document_id: target.row.id.clone(),
            rel_path: target.row.rel_path.clone(),
            root_digest: target.root_digest.clone(),
            expected_digest,
            intended_digest: asset_access::digest(&bytes),
            byte_length: bytes.len() as i64,
        };

        let prepared = self
            .executor
            .journal()
            .prepare(identity::intent(operation_id, &intent))
            .await?;
        if prepared.reused {
            if let Some(answer) = self.replayed(&intent, &target, &prepared.operation)? {
                return Ok(answer);
            }
        }
        // The bytes are held only for as long as this attempt may still need
        // to stage them; after that the staged file is the record of them.
        let held = prepared.operation.operation_id.clone();
        self.executor.bodies().hold(&held, Arc::clone(&bytes));
        let outcome = self.attempt(&held, &intent).await;
        self.executor.bodies().release(&held);
        outcome
    }

    async fn attempt(
        &self,
        operation_id: &str,
        intent: &SaveIntent,
    ) -> Result<DocumentSaveOutcome, DocumentSaveError> {
        let claim = self
            .executor
            .journal()
            .claim(operation_id, &lease_owner(), SAVE_LEASE_SECONDS)
            .await?;
        match self.executor.perform(&claim).await {
            WorkspaceOperationOutcome::Applied { .. } => Ok(saved(intent)),
            // Stale is data, not a diagnostic: the durable message stays in the
            // journal for an operator, and the window gets the digest it needs
            // to retry against.
            WorkspaceOperationOutcome::Conflicted { code, evidence, .. } if code == STALE_CODE => {
                Ok(self.stale(intent, evidence.get("currentDigest")).await)
            }
            WorkspaceOperationOutcome::Conflicted { code, message, .. } => {
                Err(DocumentSaveError::external_conflict(&code, &message))
            }
            WorkspaceOperationOutcome::Failed { code, message, .. } => {
                Err(failure(&code, &message))
            }
        }
    }

    /// The durable answer for an operation identity that is already settled.
    /// `None` means the operation is still open and may be attempted again
    /// under the same identity.
    fn replayed(
        &self,
        intent: &SaveIntent,
        target: &SaveTarget,
        operation: &WorkspaceOperationRecord,
    ) -> Result<Option<DocumentSaveOutcome>, DocumentSaveError> {
        match operation.state.as_str() {
            "applied" => Ok(Some(saved(intent))),
            "conflicted" if operation.last_error_code.as_deref() == Some(STALE_CODE) => {
                Ok(Some(DocumentSaveOutcome {
                    document_id: intent.document_id.clone(),
                    digest: target::current_digest(target)
                        .or_else(|| evidence_digest(operation))
                        .unwrap_or_else(|| intent.expected_digest.clone()),
                    saved: false,
                    stale: true,
                }))
            }
            "conflicted" => Err(DocumentSaveError::external_conflict(
                operation.last_error_code.as_deref().unwrap_or("conflict"),
                operation.last_error_message.as_deref().unwrap_or_default(),
            )),
            "failed" => Err(failure(
                operation.last_error_code.as_deref().unwrap_or("failed"),
                operation.last_error_message.as_deref().unwrap_or_default(),
            )),
            _ => Ok(None),
        }
    }

    /// The version the file actually holds after a stale save, re-read rather
    /// than remembered so the retry the editor offers is against the truth.
    async fn stale(
        &self,
        intent: &SaveIntent,
        recorded: Option<&serde_json::Value>,
    ) -> DocumentSaveOutcome {
        let digest = match target::resolve(self.executor.database(), &intent.document_id).await {
            Ok(Some(target)) => target::current_digest(&target),
            _ => None,
        }
        .or_else(|| recorded.and_then(|value| value.as_str()).map(str::to_owned))
        .unwrap_or_else(|| intent.expected_digest.clone());
        DocumentSaveOutcome {
            document_id: intent.document_id.clone(),
            digest,
            saved: false,
            stale: true,
        }
    }
}

fn saved(intent: &SaveIntent) -> DocumentSaveOutcome {
    DocumentSaveOutcome {
        document_id: intent.document_id.clone(),
        digest: intent.intended_digest.clone(),
        saved: true,
        stale: false,
    }
}

fn evidence_digest(operation: &WorkspaceOperationRecord) -> Option<String> {
    operation
        .evidence_value()?
        .get("currentDigest")?
        .as_str()
        .map(str::to_owned)
}

/// The editor's digest arrives from an ETag, so a weak-validator prefix and
/// surrounding quotes are ordinary spellings of the same value.
fn normalized_digest(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches("W/").trim_matches('"');
    let usable = value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit());
    usable.then(|| value.to_ascii_lowercase())
}

/// A lease owner that names this process's attempt, so a settlement can only
/// be reported by the worker that claimed it.
fn lease_owner() -> String {
    format!("document-save-{}", uuid::Uuid::new_v4().simple())
}

fn failure(code: &str, message: &str) -> DocumentSaveError {
    let code = match code {
        "document_save_stage_failed" | "document_save_replace_failed" => {
            return DocumentSaveError::write_failed(message)
        }
        "document_save_document_absent" => DocumentSaveErrorCode::DocumentNotFound,
        code if code.contains("storage") => DocumentSaveErrorCode::Storage,
        _ => DocumentSaveErrorCode::OperationInvalid,
    };
    DocumentSaveError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_etag_and_a_bare_digest_are_one_expected_version() {
        let digest = "a".repeat(64);
        assert_eq!(normalized_digest(&digest).as_deref(), Some(digest.as_str()));
        assert_eq!(
            normalized_digest(&format!("W/\"{}\"", digest.to_uppercase())).as_deref(),
            Some(digest.as_str())
        );
        for rejected in ["", "not-a-digest", &"a".repeat(63), &"z".repeat(64)] {
            assert_eq!(
                normalized_digest(rejected),
                None,
                "{rejected} is not usable"
            );
        }
    }
}
