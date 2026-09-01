//! The durable Workspace Operation recovery protocol.
//!
//! Every case here asserts what an operator can observe afterwards: the
//! durable state of the journal, the typed outcome a caller received, and how
//! many times an external effect was actually performed. The executor and
//! probe are test doubles precisely so that "how many effects happened" is a
//! fact the test can count, which is the property the protocol exists to
//! protect.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use async_trait::async_trait;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use serde_json::{json, Value};
use ticketry_workspace_runtime::workspace_operations::{
    schema, ClaimedOperation, ExternalObservation, OperationSubject, ReconciliationDecision,
    WorkspaceOperationError, WorkspaceOperationErrorCode, WorkspaceOperationExecutor,
    WorkspaceOperationIntent, WorkspaceOperationJournal, WorkspaceOperationKind,
    WorkspaceOperationOutcome, WorkspaceStateProbe, REDACTED,
};

const RESOURCE: &str = "spec/rusting--cf2de16d/T756/SPEC.md";

async fn journal() -> (
    tempfile::TempDir,
    DatabaseConnection,
    WorkspaceOperationJournal,
) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    schema::install(&database).await.unwrap();
    let journal = WorkspaceOperationJournal::new(database.clone());
    (directory, database, journal)
}

fn id(value: u128) -> String {
    uuid::Uuid::from_u128(value).hyphenated().to_string()
}

fn db_id(value: u128) -> String {
    uuid::Uuid::from_u128(value).simple().to_string()
}

fn save_intent(value: u128, intended_digest: &str) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: id(value),
        kind: WorkspaceOperationKind::DocumentSave,
        intent_version: 1,
        resource_key: RESOURCE.to_owned(),
        payload: json!({
            "expectedDigest": "a".repeat(64),
            "intendedDigest": intended_digest,
        }),
    }
}

fn worktree_intent(value: u128, resource_key: &str) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: id(value),
        kind: WorkspaceOperationKind::WorktreeCreate,
        intent_version: 1,
        resource_key: resource_key.to_owned(),
        payload: json!({ "branch": "task/coding-756" }),
    }
}

/// A probe whose answer the test chooses, counting how often it was consulted.
struct ScriptedProbe {
    answers: Mutex<Vec<ExternalObservation>>,
    fallback: ExternalObservation,
    observed: AtomicUsize,
}

impl ScriptedProbe {
    fn always(observation: ExternalObservation) -> Arc<Self> {
        Arc::new(Self {
            answers: Mutex::new(Vec::new()),
            fallback: observation,
            observed: AtomicUsize::new(0),
        })
    }

    fn scripted(answers: Vec<ExternalObservation>, fallback: ExternalObservation) -> Arc<Self> {
        Arc::new(Self {
            answers: Mutex::new(answers.into_iter().rev().collect()),
            fallback,
            observed: AtomicUsize::new(0),
        })
    }
}

#[async_trait]
impl WorkspaceStateProbe for ScriptedProbe {
    async fn observe(&self, _subject: OperationSubject) -> ExternalObservation {
        self.observed.fetch_add(1, Ordering::SeqCst);
        self.answers
            .lock()
            .unwrap()
            .pop()
            .unwrap_or_else(|| self.fallback.clone())
    }
}

/// An executor that counts the external effects it was actually asked for.
struct CountingExecutor {
    performed: AtomicUsize,
    outcome: Mutex<Option<WorkspaceOperationOutcome>>,
}

impl CountingExecutor {
    fn applying() -> Arc<Self> {
        Arc::new(Self {
            performed: AtomicUsize::new(0),
            outcome: Mutex::new(None),
        })
    }

    fn returning(outcome: WorkspaceOperationOutcome) -> Arc<Self> {
        Arc::new(Self {
            performed: AtomicUsize::new(0),
            outcome: Mutex::new(Some(outcome)),
        })
    }

    fn performed(&self) -> usize {
        self.performed.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl WorkspaceOperationExecutor for CountingExecutor {
    async fn execute(&self, claim: ClaimedOperation) -> WorkspaceOperationOutcome {
        self.performed.fetch_add(1, Ordering::SeqCst);
        self.outcome
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| WorkspaceOperationOutcome::Applied {
                result: json!({ "resourceKey": claim.resource_key }),
                evidence: json!({ "performed": true }),
            })
    }
}

async fn state(database: &DatabaseConnection, operation_id: &str) -> String {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT state FROM workspace_operations WHERE operation_id = '{operation_id}'"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<String>("", "state")
        .unwrap()
}

async fn stored_json(database: &DatabaseConnection, operation_id: &str, column: &str) -> Value {
    let raw = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT {column} FROM workspace_operations WHERE operation_id = '{operation_id}'"
            ),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<Option<String>>("", column)
        .unwrap();
    raw.map(|value| serde_json::from_str(&value).unwrap())
        .unwrap_or(Value::Null)
}

// ---------------------------------------------------------------- preparation

#[tokio::test]
async fn schema_installation_is_repeatable_and_verified() {
    let (_directory, database, _journal) = journal().await;
    schema::install(&database).await.unwrap();
    schema::install(&database).await.unwrap();
    schema::verify(&database).await.unwrap();
}

#[tokio::test]
async fn reusing_an_identity_with_the_same_fingerprint_returns_the_durable_result() {
    let (_directory, _database, journal) = journal().await;
    let prepared = journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    assert!(!prepared.reused);

    let claim = journal.claim(&id(1), "worker-a", 60).await.unwrap();
    assert_eq!(claim.kind, WorkspaceOperationKind::DocumentSave);
    journal
        .settle(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Applied {
                result: json!({ "digest": "b".repeat(64) }),
                evidence: json!({ "renamed": true }),
            },
        )
        .await
        .unwrap();

    // The transport retries the identical request after the effect was durable.
    let replayed = journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    assert!(replayed.reused);
    assert_eq!(replayed.operation.state, "applied");
    assert_eq!(
        replayed.operation.result().unwrap()["digest"],
        json!("b".repeat(64))
    );
}

#[tokio::test]
async fn reusing_an_identity_with_a_different_fingerprint_is_a_typed_conflict() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();

    let error = journal
        .prepare(save_intent(1, "c".repeat(64).as_str()))
        .await
        .unwrap_err();
    assert_eq!(
        error.code(),
        WorkspaceOperationErrorCode::FingerprintConflict
    );
    // The durable intent is untouched by the rejected rebinding.
    assert_eq!(state(&database, &db_id(1)).await, "prepared");
}

#[tokio::test]
async fn a_malformed_intent_version_never_becomes_a_row() {
    let (_directory, database, journal) = journal().await;
    for version in [-1, 0, 2] {
        let mut intent = save_intent(1, "b".repeat(64).as_str());
        intent.intent_version = version;
        let error = journal.prepare(intent).await.unwrap_err();
        assert_eq!(
            error.code(),
            WorkspaceOperationErrorCode::UnsupportedVersion,
            "version {version}"
        );
    }
    assert!(journal.find(&id(1)).await.unwrap().is_none());
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT operation_id FROM workspace_operations",
        ))
        .await
        .unwrap();
    assert!(rows.is_empty());
}

#[tokio::test]
async fn a_payload_carrying_secrets_paths_or_commands_is_refused() {
    let (_directory, journal_database, journal) = journal().await;
    for payload in [
        json!({ "body": "# the document" }),
        json!({ "accessToken": "abc" }),
        json!({ "command": "git worktree add" }),
        json!({ "documentPath": "/Users/someone/SPEC.md" }),
        json!({ "environment": { "HOME": "value" } }),
    ] {
        let mut intent = save_intent(1, "b".repeat(64).as_str());
        intent.payload = payload.clone();
        let error = journal.prepare(intent).await.unwrap_err();
        assert_eq!(
            error.code(),
            WorkspaceOperationErrorCode::ForbiddenPayload,
            "{payload}"
        );
    }
    let rows = journal_database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT operation_id FROM workspace_operations",
        ))
        .await
        .unwrap();
    assert!(rows.is_empty());
}

#[tokio::test]
async fn an_absolute_resource_key_is_refused() {
    let (_directory, _database, journal) = journal().await;
    let mut intent = save_intent(1, "b".repeat(64).as_str());
    intent.resource_key = "/Users/someone/SPEC.md".to_owned();
    assert_eq!(
        journal.prepare(intent).await.unwrap_err().code(),
        WorkspaceOperationErrorCode::InvalidIntent
    );
}

// -------------------------------------------------------- claims and contention

#[tokio::test]
async fn only_one_worker_holds_a_live_claim() {
    let (_directory, _database, journal) = journal().await;
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();

    journal.claim(&id(1), "worker-a", 300).await.unwrap();
    let contended = journal.claim(&id(1), "worker-b", 300).await.unwrap_err();
    assert_eq!(contended.code(), WorkspaceOperationErrorCode::Busy);

    // The loser cannot settle what it never held.
    let error = journal
        .settle(
            &id(1),
            "worker-b",
            WorkspaceOperationOutcome::Applied {
                result: json!({}),
                evidence: json!({}),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), WorkspaceOperationErrorCode::LeaseNotHeld);
}

#[tokio::test]
async fn an_expired_lease_becomes_claimable_again_under_the_same_identity() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    let first = journal.claim(&id(1), "worker-a", 1).await.unwrap();
    expire_lease(&database, &db_id(1)).await;

    let second = journal.claim(&id(1), "worker-b", 300).await.unwrap();
    assert_eq!(second.operation_id, first.operation_id);
    assert_eq!(second.attempt_count, first.attempt_count + 1);

    // The abandoned holder can no longer settle it.
    let error = journal
        .settle(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Applied {
                result: json!({}),
                evidence: json!({}),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), WorkspaceOperationErrorCode::LeaseNotHeld);
}

#[tokio::test]
async fn a_settled_operation_cannot_be_claimed_again() {
    let (_directory, _database, journal) = journal().await;
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    journal.claim(&id(1), "worker-a", 300).await.unwrap();
    journal
        .settle(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Applied {
                result: json!({}),
                evidence: json!({}),
            },
        )
        .await
        .unwrap();

    let error = journal.claim(&id(1), "worker-b", 300).await.unwrap_err();
    assert_eq!(error.code(), WorkspaceOperationErrorCode::AlreadySettled);
}

async fn expire_lease(database: &DatabaseConnection, operation_id: &str) {
    database
        .execute_unprepared(&format!(
            "UPDATE workspace_operations SET lease_expires_at = '2000-01-01 00:00:00' \
             WHERE operation_id = '{operation_id}'"
        ))
        .await
        .unwrap();
}

// ------------------------------------------------------------------ settlement

#[tokio::test]
async fn settlement_commits_the_callers_own_work_in_the_same_transaction() {
    let (_directory, database, journal) = journal().await;
    database
        .execute_unprepared("CREATE TABLE saved_documents (resource_key text PRIMARY KEY)")
        .await
        .unwrap();
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    journal.claim(&id(1), "worker-a", 300).await.unwrap();

    // A settlement that refuses leaves neither the operation nor the model row.
    let rejected = journal
        .settle_with(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Applied {
                result: json!({}),
                evidence: json!({}),
            },
            |transaction| {
                Box::pin(async move {
                    transaction
                        .execute_unprepared(
                            "INSERT INTO saved_documents (resource_key) VALUES ('rejected')",
                        )
                        .await
                        .unwrap();
                    Err(WorkspaceOperationError::from(sea_orm::DbErr::Custom(
                        "the model refused this settlement".to_owned(),
                    )))
                })
            },
        )
        .await;
    assert!(rejected.is_err());
    assert_eq!(state(&database, &db_id(1)).await, "leased");
    assert_eq!(saved_document_count(&database).await, 0);

    // A settlement that succeeds commits both halves together.
    journal
        .settle_with(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Applied {
                result: json!({}),
                evidence: json!({}),
            },
            |transaction| {
                Box::pin(async move {
                    transaction
                        .execute_unprepared(
                            "INSERT INTO saved_documents (resource_key) VALUES ('saved')",
                        )
                        .await
                        .unwrap();
                    Ok(())
                })
            },
        )
        .await
        .unwrap();
    assert_eq!(state(&database, &db_id(1)).await, "applied");
    assert_eq!(saved_document_count(&database).await, 1);
}

async fn saved_document_count(database: &DatabaseConnection) -> usize {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT resource_key FROM saved_documents",
        ))
        .await
        .unwrap()
        .len()
}

#[tokio::test]
async fn a_repeated_acknowledgement_is_a_no_op_and_a_contradicting_one_is_refused() {
    let (_directory, _database, journal) = journal().await;
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    journal.claim(&id(1), "worker-a", 300).await.unwrap();
    let applied = WorkspaceOperationOutcome::Applied {
        result: json!({ "digest": "b".repeat(64) }),
        evidence: json!({ "renamed": true }),
    };
    assert!(
        journal
            .settle(&id(1), "worker-a", applied.clone())
            .await
            .unwrap()
            .settled
    );

    let repeated = journal.settle(&id(1), "worker-a", applied).await.unwrap();
    assert!(!repeated.settled);
    assert_eq!(repeated.operation.state, "applied");

    let contradicting = journal
        .settle(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Failed {
                code: "document_save_failed".to_owned(),
                message: "late failure".to_owned(),
                retryable: false,
                cleanup_confirmed: true,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(
        contradicting.code(),
        WorkspaceOperationErrorCode::AlreadySettled
    );
}

#[tokio::test]
async fn a_retryable_failure_returns_to_processing_under_the_same_identity() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    journal.claim(&id(1), "worker-a", 300).await.unwrap();
    journal
        .settle(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Failed {
                code: "staging_write_failed".to_owned(),
                message: "the staging file could not be flushed".to_owned(),
                retryable: true,
                cleanup_confirmed: true,
            },
        )
        .await
        .unwrap();

    assert_eq!(state(&database, &db_id(1)).await, "prepared");
    let record = journal.find(&id(1)).await.unwrap().unwrap();
    assert_eq!(
        record.last_error_code.as_deref(),
        Some("staging_write_failed")
    );
    // The same identity is claimable again — no second operation is minted.
    let reclaimed = journal.claim(&id(1), "worker-b", 300).await.unwrap();
    assert_eq!(reclaimed.attempt_count, 2);
}

#[tokio::test]
async fn diagnostics_lose_their_local_paths_before_they_are_durable() {
    let (_directory, _database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    journal.claim(&id(1), "worker-a", 300).await.unwrap();
    journal
        .settle(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Conflicted {
                code: "worktree_path_taken".to_owned(),
                message: "fatal: '/Users/someone/checkout' is already registered".to_owned(),
                evidence: json!({
                    "branch": "task/coding-756",
                    "gitCommand": "git worktree add",
                }),
            },
        )
        .await
        .unwrap();

    let record = journal.find(&id(1)).await.unwrap().unwrap();
    let message = record.last_error_message.clone().unwrap();
    assert!(!message.contains("/Users/someone"));
    assert!(message.contains("already registered"));
    let evidence = record.evidence_value().unwrap();
    assert_eq!(evidence["branch"], json!("task/coding-756"));
    assert_eq!(evidence["gitCommand"], json!(REDACTED));
}

// -------------------------------------------------------------- reconciliation

#[tokio::test]
async fn an_expired_lease_alone_never_performs_a_second_effect() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    journal.claim(&id(1), "worker-a", 1).await.unwrap();
    expire_lease(&database, &db_id(1)).await;

    // The crashed worker did create the checkout; the probe can see it.
    let probe = ScriptedProbe::always(ExternalObservation::Applied {
        evidence: json!({ "branch": "task/coding-756" }),
    });
    let executor = CountingExecutor::applying();
    let report = journal
        .reconcile_with(probe.clone(), executor.clone())
        .reconcile()
        .await
        .unwrap();

    assert_eq!(
        report.decision(&id(1)),
        Some(&ReconciliationDecision::Adopted)
    );
    assert_eq!(executor.performed(), 0, "adoption must not act again");
    assert_eq!(state(&database, &db_id(1)).await, "applied");
}

#[tokio::test]
async fn a_provably_absent_effect_is_executed_once_under_the_same_identity() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    let probe = ScriptedProbe::always(ExternalObservation::Absent);
    let executor = CountingExecutor::applying();
    let reconciler = journal.reconcile_with(probe.clone(), executor.clone());

    reconciler.reconcile().await.unwrap();
    assert_eq!(state(&database, &db_id(1)).await, "applied");

    // A second pass is a no-op: the operation is settled and no longer due.
    let second = reconciler.reconcile().await.unwrap();
    assert!(second.reconciled.is_empty());
    assert_eq!(executor.performed(), 1);
    assert_eq!(
        stored_json(&database, &db_id(1), "result_summary").await["resourceKey"],
        json!("coding-756")
    );
}

#[tokio::test]
async fn uncertain_evidence_defers_without_touching_the_operation() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    let probe = ScriptedProbe::always(ExternalObservation::Uncertain {
        detail: "git is unavailable".to_owned(),
    });
    let executor = CountingExecutor::applying();
    let reconciler = journal.reconcile_with(probe.clone(), executor.clone());

    let report = reconciler.reconcile().await.unwrap();
    assert!(matches!(
        report.decision(&id(1)),
        Some(ReconciliationDecision::Deferred { .. })
    ));
    assert_eq!(executor.performed(), 0);
    assert_eq!(state(&database, &db_id(1)).await, "prepared");

    // A second pass with a decidable answer converges — deferral is not a
    // terminal state.
    let deciding = journal.reconcile_with(
        ScriptedProbe::always(ExternalObservation::Absent),
        executor.clone(),
    );
    deciding.reconcile().await.unwrap();
    assert_eq!(state(&database, &db_id(1)).await, "applied");
    assert_eq!(executor.performed(), 1);
}

#[tokio::test]
async fn contradicting_external_state_becomes_a_retained_conflict() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    let probe = ScriptedProbe::always(ExternalObservation::Conflicting {
        code: "worktree_path_taken".to_owned(),
        detail: "another checkout owns the derived path".to_owned(),
    });
    let executor = CountingExecutor::applying();
    let reconciler = journal.reconcile_with(probe, executor.clone());

    let report = reconciler.reconcile().await.unwrap();
    assert_eq!(
        report.decision(&id(1)),
        Some(&ReconciliationDecision::Conflicted {
            code: "worktree_path_taken".to_owned()
        })
    );
    assert_eq!(executor.performed(), 0);
    assert_eq!(state(&database, &db_id(1)).await, "conflicted");

    // Restarting does not erase the cause, and does not retry the conflict.
    let second = reconciler.reconcile().await.unwrap();
    assert!(second.reconciled.is_empty());
    let record = journal.find(&id(1)).await.unwrap().unwrap();
    assert_eq!(
        record.last_error_code.as_deref(),
        Some("worktree_path_taken")
    );
    assert_eq!(
        record.evidence_value().unwrap()["detail"],
        json!("another checkout owns the derived path")
    );
}

#[tokio::test]
async fn cleanup_pending_survives_until_the_remnant_is_provably_gone() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    journal.claim(&id(1), "worker-a", 300).await.unwrap();
    journal
        .settle(
            &id(1),
            "worker-a",
            WorkspaceOperationOutcome::Failed {
                code: "worktree_create_failed".to_owned(),
                message: "the checkout may be half-created".to_owned(),
                retryable: false,
                cleanup_confirmed: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(state(&database, &db_id(1)).await, "cleanup_pending");

    let executor = CountingExecutor::applying();
    // A surviving remnant keeps it pending with fresh evidence.
    let pending = journal
        .reconcile_with(
            ScriptedProbe::always(ExternalObservation::Applied {
                evidence: json!({ "branch": "task/coding-756" }),
            }),
            executor.clone(),
        )
        .reconcile()
        .await
        .unwrap();
    assert_eq!(
        pending.decision(&id(1)),
        Some(&ReconciliationDecision::CleanupPending)
    );
    assert_eq!(state(&database, &db_id(1)).await, "cleanup_pending");
    assert_eq!(
        stored_json(&database, &db_id(1), "evidence").await["cleanup"],
        json!("pending")
    );

    // Proven absence settles it, and it stops being reconciled.
    let complete = journal
        .reconcile_with(
            ScriptedProbe::always(ExternalObservation::Absent),
            executor.clone(),
        )
        .reconcile()
        .await
        .unwrap();
    assert_eq!(
        complete.decision(&id(1)),
        Some(&ReconciliationDecision::CleanupCompleted)
    );
    assert_eq!(state(&database, &db_id(1)).await, "failed");
    assert_eq!(executor.performed(), 0);
}

#[tokio::test]
async fn an_ambiguous_resource_is_isolated_without_blocking_unrelated_ones() {
    let (_directory, database, journal) = journal().await;
    // Two operations on one repository, and one on a different repository.
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    journal
        .prepare(worktree_intent(2, "coding-756"))
        .await
        .unwrap();
    journal
        .prepare(worktree_intent(3, "coding-999"))
        .await
        .unwrap();

    // The first subject cannot be decided; everything else can.
    let probe = ScriptedProbe::scripted(
        vec![ExternalObservation::Uncertain {
            detail: "the repository is locked by another process".to_owned(),
        }],
        ExternalObservation::Absent,
    );
    let executor = CountingExecutor::applying();
    let report = journal
        .reconcile_with(probe, executor.clone())
        .reconcile()
        .await
        .unwrap();

    assert!(matches!(
        report.decision(&id(1)),
        Some(ReconciliationDecision::Deferred { .. })
    ));
    // The sibling on the ambiguous repository is held back, not guessed at.
    assert_eq!(
        report.decision(&id(2)),
        Some(&ReconciliationDecision::Isolated)
    );
    assert_eq!(state(&database, &db_id(2)).await, "prepared");
    // The unrelated repository still converges in the same pass.
    assert_eq!(
        report.decision(&id(3)),
        Some(&ReconciliationDecision::Executed {
            state: "applied".to_owned()
        })
    );
    assert_eq!(state(&database, &db_id(3)).await, "applied");
    assert_eq!(executor.performed(), 1);
}

#[tokio::test]
async fn reconciliation_is_bounded_and_reports_a_saturated_batch() {
    let (_directory, _database, journal) = journal().await;
    for index in 1..=5u128 {
        journal
            .prepare(worktree_intent(index, &format!("coding-{index}")))
            .await
            .unwrap();
    }
    let report = journal
        .reconcile_with(
            ScriptedProbe::always(ExternalObservation::Absent),
            CountingExecutor::applying(),
        )
        .reconcile()
        .await
        .unwrap();
    assert_eq!(report.scanned, 5);
    assert!(!report.saturated());
    assert!(report.scanned as u64 <= report.batch_limit);
}

#[tokio::test]
async fn a_failed_execution_during_reconciliation_keeps_its_typed_evidence() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "coding-756"))
        .await
        .unwrap();
    let executor = CountingExecutor::returning(WorkspaceOperationOutcome::Failed {
        code: "worktree_create_failed".to_owned(),
        message: "git refused to create the checkout".to_owned(),
        retryable: false,
        cleanup_confirmed: true,
    });
    let report = journal
        .reconcile_with(
            ScriptedProbe::always(ExternalObservation::Absent),
            executor.clone(),
        )
        .reconcile()
        .await
        .unwrap();

    assert_eq!(
        report.decision(&id(1)),
        Some(&ReconciliationDecision::Executed {
            state: "failed".to_owned()
        })
    );
    assert_eq!(state(&database, &db_id(1)).await, "failed");
    // A restart does not re-attempt a settled non-retryable failure.
    let second = journal
        .reconcile_with(
            ScriptedProbe::always(ExternalObservation::Absent),
            executor.clone(),
        )
        .reconcile()
        .await
        .unwrap();
    assert!(second.reconciled.is_empty());
    assert_eq!(executor.performed(), 1);
}

// ------------------------------------------------------------- schema surface

#[tokio::test]
async fn the_journal_intent_is_immutable_once_durable() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(save_intent(1, "b".repeat(64).as_str()))
        .await
        .unwrap();
    let refused = database
        .execute_unprepared(&format!(
            "UPDATE workspace_operations SET resource_key = 'somewhere/else.md' \
             WHERE operation_id = '{}'",
            db_id(1)
        ))
        .await;
    assert!(
        refused.is_err(),
        "immutable intent must be refused by the schema"
    );
}

#[tokio::test]
async fn the_journal_is_absent_from_the_public_graphql_surface() {
    let (_directory, database, _journal) = journal().await;
    let schema = ticketry_graphql_schema::foundation_schema(
        database, None, None, None, None, None, None, None, None,
    )
    .unwrap();
    let sdl = schema.sdl();
    assert!(
        !sdl.contains("WorkspaceOperation"),
        "the operation journal must have no public query or mutation bundle"
    );
    assert!(!sdl.contains("workspaceOperation"));
}

// ------------------------------------------------------------- checkpoints

#[tokio::test]
async fn checkpoints_accumulate_boundary_evidence_without_settling_the_operation() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "worktree/story"))
        .await
        .unwrap();
    journal.claim(&id(1), "lander", 60).await.unwrap();

    journal
        .record_checkpoint(&id(1), "lander", json!({ "merged": true }))
        .await
        .unwrap();
    let recorded = journal
        .record_checkpoint(&id(1), "lander", json!({ "landedCommit": "abc123" }))
        .await
        .unwrap();

    // One step never erases the step before it, because a later pass has to be
    // able to read every boundary the attempt got past.
    assert_eq!(recorded.checkpoint()["merged"], json!(true));
    assert_eq!(recorded.checkpoint()["landedCommit"], json!("abc123"));
    assert!(recorded.checkpoint()["observedAt"].is_string());
    assert_eq!(
        state(&database, &db_id(1)).await,
        "leased",
        "evidence is not an outcome"
    );
    assert_eq!(
        stored_json(&database, &db_id(1), "evidence").await["checkpoint"]["landedCommit"],
        json!("abc123")
    );
}

#[tokio::test]
async fn only_the_worker_holding_the_lease_may_record_evidence() {
    let (_directory, database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "worktree/story"))
        .await
        .unwrap();

    // Nobody is acting yet.
    assert_eq!(
        journal
            .record_checkpoint(&id(1), "lander", json!({ "merged": true }))
            .await
            .unwrap_err()
            .code(),
        WorkspaceOperationErrorCode::LeaseNotHeld
    );

    journal.claim(&id(1), "lander", 60).await.unwrap();
    assert_eq!(
        journal
            .record_checkpoint(&id(1), "another-worker", json!({ "merged": true }))
            .await
            .unwrap_err()
            .code(),
        WorkspaceOperationErrorCode::LeaseNotHeld
    );
    assert_eq!(
        stored_json(&database, &db_id(1), "evidence").await,
        Value::Null,
        "a refused checkpoint writes nothing"
    );
}

#[tokio::test]
async fn checkpoint_evidence_is_bounded_and_redacted_before_it_is_durable() {
    let (_directory, _database, journal) = journal().await;
    journal
        .prepare(worktree_intent(1, "worktree/story"))
        .await
        .unwrap();
    journal.claim(&id(1), "lander", 60).await.unwrap();

    let recorded = journal
        .record_checkpoint(
            &id(1),
            "lander",
            json!({ "landedCommit": "abc123", "command": "git merge main" }),
        )
        .await
        .unwrap();

    assert_eq!(recorded.checkpoint()["landedCommit"], json!("abc123"));
    assert_eq!(recorded.checkpoint()["command"], json!(REDACTED));
    assert!(journal
        .record_checkpoint(&id(1), "lander", json!("not an object"))
        .await
        .is_err());
}
