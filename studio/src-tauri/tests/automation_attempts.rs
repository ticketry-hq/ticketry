use std::path::{Path, PathBuf};
use std::process::Command;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use ticketry_runs::{
    adopt, AttemptOutcome, RunsPersistenceErrorCode, RunsServices, TransitionOccurrence,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

fn fixture(path: &Path) {
    let script = r#"
import os, sys, uuid
from pathlib import Path
p=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(p); os.environ['MUXED_DATA_DIR']=str(p.parent); os.environ['MUXED_FORCE_SQLITE']='true'
import django; django.setup()
from django.core.management import call_command
from worktracker.models import Workspace, Project, State, IssueType, Issue
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id=uuid.UUID(int=800),slug='attempt-fixture',name='Attempt Fixture')
for base in (800, 810):
    project=Project.objects.create(id=uuid.UUID(int=base+1),workspace=w,name=f'Project {base}',slug=f'P{base}')
    state=State.objects.create(id=uuid.UUID(int=base+2),project=project,name='Todo',group='unstarted',sort_order=1)
    kind=IssueType.objects.create(id=uuid.UUID(int=base+3),project=project,name='Story',level='task',sort_order=1,start_state=state)
    Issue.objects.create(id=uuid.UUID(int=base+4),project=project,type='task',issue_type=kind,state=state,name='Attempt fixture',sequence_id=base,rank='z')
"#;
    let output = Command::new(root().join("backend/.venv/bin/python"))
        .arg("-c")
        .arg(script)
        .arg(path)
        .current_dir(root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn open(path: &Path) -> sea_orm::DatabaseConnection {
    Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap()
}

fn id(value: u128) -> String {
    uuid::Uuid::from_u128(value).hyphenated().to_string()
}

fn occurrence(value: u128, base: u128) -> TransitionOccurrence {
    TransitionOccurrence {
        occurrence_id: id(value),
        issue_id: id(base + 4),
        project_id: id(base + 1),
        from_state_id: id(base + 2),
        to_state_id: id(base + 2),
        workflow_revision: 7,
    }
}

async fn event_count(database: &sea_orm::DatabaseConnection) -> i64 {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM runs_status_events".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "count")
        .unwrap()
}

/// Retryability is a published decision about a failure, and the projection
/// that Studio consumes must say so for every attempt state — not echo the
/// stored column, which stays `true` on a freshly materialized attempt so a
/// later failure can lower it.
#[tokio::test]
async fn projections_publish_retryability_only_for_failures_and_list_newest_first() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);
    adopt(directory.path()).await.unwrap();
    let services = RunsServices::new(open(&path).await);

    let first = services
        .attempts()
        .materialize_root(&occurrence(900, 800))
        .await
        .unwrap();
    assert_eq!(first.status, "pending");
    assert!(!first.retryable, "a pending attempt is not retryable");

    let second = services
        .attempts()
        .materialize_root(&occurrence(901, 800))
        .await
        .unwrap();
    assert_eq!(
        services
            .attempts()
            .latest(&id(801), None)
            .await
            .unwrap()
            .into_iter()
            .map(|attempt| attempt.attempt_id)
            .collect::<Vec<_>>(),
        vec![second.attempt_id.clone(), first.attempt_id.clone()],
        "unresolved lineages are listed newest first"
    );

    let failed = services
        .attempts()
        .record_outcome(
            &first.attempt_id,
            AttemptOutcome::Failed {
                error: "Provider timed out".to_owned(),
                failure: serde_json::json!({"code": "provider_timeout"}),
                retryable: true,
            },
        )
        .await
        .unwrap();
    assert!(
        failed.retryable,
        "a retryable failure publishes its decision"
    );

    let succeeded = services
        .attempts()
        .record_outcome(
            &second.attempt_id,
            AttemptOutcome::Succeeded {
                agent: "codex".to_owned(),
                agent_run_id: "run-901".to_owned(),
            },
        )
        .await
        .unwrap();
    assert_eq!(succeeded.status, "succeeded");
    assert!(!succeeded.retryable, "a succeeded attempt is not retryable");
    assert_eq!(
        services.attempts().latest(&id(801), None).await.unwrap(),
        vec![failed.clone()],
        "a succeeded lineage resolves and only the failed lineage stays visible"
    );

    let retry = services.attempts().retry(&failed.attempt_id).await.unwrap();
    assert_eq!(retry.status, "pending");
    assert!(
        !retry.retryable,
        "a pending retry child is not itself retryable yet"
    );
}

#[tokio::test]
async fn attempts_are_idempotent_durable_scoped_and_event_atomic() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);
    adopt(directory.path()).await.unwrap();
    let database = open(&path).await;
    let services = RunsServices::new(database.clone());
    let first_occurrence = occurrence(900, 800);

    let (left, right) = tokio::join!(
        services.attempts().materialize_root(&first_occurrence),
        services.attempts().materialize_root(&first_occurrence),
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_eq!(left.attempt_id, right.attempt_id);
    assert_eq!(left.status, "pending");
    assert_eq!(event_count(&database).await, 1);
    assert_eq!(
        services
            .attempts()
            .materialize_root(&first_occurrence)
            .await
            .unwrap()
            .attempt_id,
        left.attempt_id
    );
    assert_eq!(event_count(&database).await, 1);
    assert_eq!(
        services
            .attempts()
            .latest(&id(801), Some(&id(804)))
            .await
            .unwrap(),
        vec![left.clone()]
    );
    assert!(services
        .attempts()
        .latest(&id(811), None)
        .await
        .unwrap()
        .is_empty());

    let failure = serde_json::json!({
        "code": "required_skill_unavailable",
        "skill": "fixture-skill"
    });
    let failed = services
        .attempts()
        .record_outcome(
            &left.attempt_id,
            AttemptOutcome::Failed {
                error: "Required skill is unavailable".to_owned(),
                failure: failure.clone(),
                retryable: true,
            },
        )
        .await
        .unwrap();
    let duplicate = services
        .attempts()
        .record_outcome(
            &left.attempt_id,
            AttemptOutcome::Failed {
                error: "delivery duplicate".to_owned(),
                failure: serde_json::json!({"code": "ignored_duplicate"}),
                retryable: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(duplicate, failed);
    assert_eq!(duplicate.failure.unwrap().0, failure);
    assert_eq!(event_count(&database).await, 2);
    assert_eq!(
        services
            .attempts()
            .record_outcome(
                &left.attempt_id,
                AttemptOutcome::Succeeded {
                    agent: "codex".to_owned(),
                    agent_run_id: "run-conflict".to_owned(),
                },
            )
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::Conflict
    );
    assert_eq!(event_count(&database).await, 2);

    let (retry_left, retry_right) = tokio::join!(
        services.attempts().retry(&left.attempt_id),
        services.attempts().retry(&left.attempt_id),
    );
    let (retry_left, retry_refusal) = match (retry_left, retry_right) {
        (Ok(retry), Err(refusal)) | (Err(refusal), Ok(retry)) => (retry, refusal),
        outcomes => panic!("exactly one retry must be accepted: {outcomes:?}"),
    };
    assert_eq!(
        retry_refusal.code(),
        RunsPersistenceErrorCode::AttemptNotRetryable
    );
    assert_ne!(retry_left.attempt_id, left.attempt_id);
    assert_eq!(retry_left.root_attempt_id, left.attempt_id);
    assert_eq!(
        retry_left.retry_of_attempt_id.as_deref(),
        Some(left.attempt_id.as_str())
    );
    assert_eq!(event_count(&database).await, 3);

    let retry_failed = services
        .attempts()
        .record_outcome(
            &retry_left.attempt_id,
            AttemptOutcome::Failed {
                error: "Provider rejected launch".to_owned(),
                failure: serde_json::json!({"code": "provider_rejected"}),
                retryable: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        services
            .attempts()
            .retry(&retry_failed.attempt_id)
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::AttemptNotRetryable,
        "a failed retry child cannot mint a second retry"
    );
    assert_eq!(
        services.attempts().latest(&id(801), None).await.unwrap(),
        vec![retry_failed.clone()]
    );
    services
        .attempts()
        .dismiss(&retry_failed.attempt_id)
        .await
        .unwrap();
    services
        .attempts()
        .dismiss(&retry_failed.attempt_id)
        .await
        .unwrap();
    assert!(services
        .attempts()
        .latest(&id(801), None)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(event_count(&database).await, 5);

    database.close().await.unwrap();
    let reopened = open(&path).await;
    let reopened_services = RunsServices::new(reopened.clone());
    let persisted = reopened_services
        .queries()
        .attempts()
        .find(&retry_failed.attempt_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(persisted.status, "failed");
    assert!(!persisted.retryable);
    assert!(persisted.dismissed_at.is_some());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(persisted.error_details.as_deref().unwrap())
            .unwrap()["code"],
        "provider_rejected"
    );
    assert!(reopened_services
        .attempts()
        .latest(&id(801), None)
        .await
        .unwrap()
        .is_empty());

    let second_occurrence = occurrence(901, 810);
    let second = reopened_services
        .attempts()
        .materialize_root(&second_occurrence)
        .await
        .unwrap();
    let before_rollback = event_count(&reopened).await;
    reopened
        .execute_unprepared(
            r#"
            CREATE TRIGGER reject_attempt_outcome_event
            BEFORE INSERT ON runs_status_events
            WHEN NEW.event_kind='automation_attempt_outcome'
            BEGIN SELECT RAISE(ABORT, 'injected event failure'); END
            "#,
        )
        .await
        .unwrap();
    assert!(reopened_services
        .attempts()
        .record_outcome(
            &second.attempt_id,
            AttemptOutcome::Failed {
                error: "must roll back".to_owned(),
                failure: serde_json::json!({"code": "injected"}),
                retryable: false,
            },
        )
        .await
        .is_err());
    reopened
        .execute_unprepared("DROP TRIGGER reject_attempt_outcome_event")
        .await
        .unwrap();
    assert_eq!(event_count(&reopened).await, before_rollback);
    assert_eq!(
        reopened_services
            .queries()
            .attempts()
            .find(&second.attempt_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );

    reopened_services
        .attempts()
        .record_outcome(
            &second.attempt_id,
            AttemptOutcome::Failed {
                error: "permanent".to_owned(),
                failure: serde_json::json!({"code": "permanent"}),
                retryable: false,
            },
        )
        .await
        .unwrap();
    let before_rejection = event_count(&reopened).await;
    assert_eq!(
        reopened_services
            .attempts()
            .retry(&second.attempt_id)
            .await
            .unwrap_err()
            .code(),
        RunsPersistenceErrorCode::AttemptNotRetryable
    );
    assert_eq!(event_count(&reopened).await, before_rejection);
    assert_eq!(
        reopened_services
            .attempts()
            .latest(&id(811), Some(&id(814)))
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(reopened_services
        .attempts()
        .latest(&id(801), Some(&id(814)))
        .await
        .unwrap()
        .is_empty());
}
