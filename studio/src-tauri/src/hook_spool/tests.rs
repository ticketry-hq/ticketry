use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::{Map, Value};
use tempfile::TempDir;

use super::*;
use crate::runs_persistence::RunsPersistenceErrorCode;

#[derive(Clone, Default)]
struct FakeSink {
    facts: Arc<Mutex<Vec<LifecycleFact>>>,
    unavailable: Arc<AtomicBool>,
}

#[async_trait]
impl HookLifecycleSink for FakeSink {
    async fn accept(
        &self,
        fact: LifecycleFact,
    ) -> Result<LifecycleAcceptance, RunsPersistenceError> {
        if self.unavailable.load(Ordering::SeqCst) {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::Storage,
                "injected storage failure",
            ));
        }
        self.facts.lock().expect("facts lock").push(fact.clone());
        Ok(LifecycleAcceptance {
            accepted: true,
            known_run: true,
            applied: true,
            state: Some("working".to_owned()),
            occurred_at: fact.occurred_at,
            event_cursor: Some(1),
        })
    }
}

fn spool(root: &TempDir, sink: FakeSink, batch: usize) -> HookSpool<FakeSink> {
    HookSpool::new(root.path().to_path_buf(), sink, batch).expect("hook spool")
}

fn publish(root: &Path, name: &str, payload: &[u8]) -> PathBuf {
    let path = root.join(name);
    fs::write(&path, payload).expect("write hook");
    path
}

#[tokio::test]
async fn accepted_provider_events_are_mapped_and_removed_after_acknowledgement() {
    let root = TempDir::new().expect("spool root");
    let spool = spool(&root, FakeSink::default(), DEFAULT_BATCH_SIZE);
    let path = publish(
        root.path(),
        "v1__agy__run-123__nonce.hook",
        br#"{"hook_event_name":"Notification","conversationId":"provider-1"}"#,
    );

    let report = spool.drain_once().await;

    assert_eq!(report.accepted, 1);
    assert!(!path.exists());
    let facts = spool.sink.facts.lock().expect("facts lock");
    assert_eq!(facts[0].kind, "awaiting_input");
    assert_eq!(facts[0].agent_run_id, "run-123");
    assert_eq!(facts[0].provider_session_id.as_deref(), Some("provider-1"));
}

#[test]
fn provider_event_maps_match_the_existing_hook_contracts() {
    let cases = [
        ("claude", "PermissionRequest", "awaiting_input"),
        ("codex", "PermissionRequest", "permission_required"),
        ("codex", "Stop", "awaiting_input"),
        ("gemini", "AfterAgent", "turn_complete"),
        ("agy", "SessionEnd", "session_end"),
    ];
    for (provider, event, expected) in cases {
        let payload = Map::from_iter([(
            "hook_event_name".to_owned(),
            Value::String(event.to_owned()),
        )]);
        let fact = map_provider_event(provider, "run-1", &payload)
            .expect("valid provider event")
            .expect("mapped provider event");
        assert_eq!(fact.kind, expected);
    }
}

#[tokio::test]
async fn accepts_valid_json_at_the_one_megabyte_boundary() {
    let root = TempDir::new().expect("spool root");
    let spool = spool(&root, FakeSink::default(), DEFAULT_BATCH_SIZE);
    let prefix = br#"{"hook_event_name":"SessionStart","padding":""#;
    let suffix = br#""}"#;
    let mut payload = Vec::with_capacity(MAX_HOOK_BYTES as usize);
    payload.extend_from_slice(prefix);
    payload.extend(std::iter::repeat_n(
        b'x',
        MAX_HOOK_BYTES as usize - prefix.len() - suffix.len(),
    ));
    payload.extend_from_slice(suffix);
    assert_eq!(payload.len(), MAX_HOOK_BYTES as usize);
    publish(root.path(), "v1__codex__run-1__boundary.hook", &payload);

    assert_eq!(spool.drain_once().await.accepted, 1);
}

#[tokio::test]
async fn unmapped_events_are_intentional_no_ops_and_partial_files_are_ignored() {
    let root = TempDir::new().expect("spool root");
    let spool = spool(&root, FakeSink::default(), DEFAULT_BATCH_SIZE);
    let no_op = publish(
        root.path(),
        "v1__codex__run-123__noop.hook",
        br#"{"hook_event_name":"FutureEvent"}"#,
    );
    let partial = publish(
        root.path(),
        ".v1__codex__run-123__partial.tmp",
        br#"{"hook_event_name":"SessionStart""#,
    );

    let report = spool.drain_once().await;

    assert_eq!(report.no_op, 1);
    assert!(!no_op.exists());
    assert!(partial.exists());
}

#[tokio::test]
async fn transient_acceptance_failure_remains_retryable_across_restart() {
    let root = TempDir::new().expect("spool root");
    let sink = FakeSink::default();
    sink.unavailable.store(true, Ordering::SeqCst);
    let first_runtime = spool(&root, sink.clone(), DEFAULT_BATCH_SIZE);
    let path = publish(
        root.path(),
        "v1__claude__run-123__retry.hook",
        br#"{"hook_event_name":"SessionStart","session_id":"provider-1"}"#,
    );

    let failed = first_runtime.drain_once().await;
    assert_eq!(failed.retained, 1);
    assert!(path.exists());

    sink.unavailable.store(false, Ordering::SeqCst);
    let restarted = spool(&root, sink, DEFAULT_BATCH_SIZE).drain_once().await;
    assert_eq!(restarted.accepted, 1);
    assert!(!path.exists());
}

#[tokio::test]
async fn permanent_invalid_input_is_quarantined_out_of_the_hot_path() {
    let root = TempDir::new().expect("spool root");
    let spool = spool(&root, FakeSink::default(), DEFAULT_BATCH_SIZE);
    publish(root.path(), "v1__codex__run-1__json.hook", b"not json");
    publish(
        root.path(),
        "v2__codex__run-1__file-version.hook",
        br#"{"hook_event_name":"SessionStart"}"#,
    );
    publish(
        root.path(),
        "v1__future__run-1__provider.hook",
        br#"{"hook_event_name":"SessionStart"}"#,
    );
    publish(
        root.path(),
        "v1__gemini__run-1__payload-version.hook",
        br#"{"ticketry_hook_version":2,"hook_event_name":"SessionStart"}"#,
    );
    publish(
        root.path(),
        "v1__codex__run-1__large.hook",
        &vec![b'x'; MAX_HOOK_BYTES as usize + 1],
    );
    fs::create_dir(root.path().join("v1__codex__run-1__directory.hook")).expect("non-regular hook");

    let report = spool.drain_once().await;

    assert_eq!(report.quarantined, 6);
    assert_eq!(spool.drain_once().await.scanned, 0);
    assert_eq!(
        fs::read_dir(root.path().join(QUARANTINE_DIRECTORY))
            .expect("quarantine")
            .count(),
        6
    );
}

#[cfg(unix)]
#[tokio::test]
async fn symlinks_are_quarantined_without_reading_their_target() {
    use std::os::unix::fs::symlink;

    let root = TempDir::new().expect("spool root");
    let outside = TempDir::new().expect("outside root");
    let target = publish(
        outside.path(),
        "target.json",
        br#"{"hook_event_name":"SessionStart"}"#,
    );
    symlink(target, root.path().join("v1__codex__run-1__link.hook")).expect("hook symlink");
    let spool = spool(&root, FakeSink::default(), DEFAULT_BATCH_SIZE);

    let report = spool.drain_once().await;

    assert_eq!(report.quarantined, 1);
    assert!(report.diagnostics.contains(&HookDiagnostic::UnsafeFileType));
}

#[tokio::test]
async fn drains_are_bounded_and_report_an_unavailable_root() {
    let root = TempDir::new().expect("spool root");
    let spool = spool(&root, FakeSink::default(), 2);
    for nonce in 0..3 {
        publish(
            root.path(),
            &format!("v1__codex__run-1__{nonce}.hook"),
            br#"{"hook_event_name":"SessionStart"}"#,
        );
    }
    assert_eq!(spool.drain_once().await.scanned, 2);
    assert_eq!(spool.drain_once().await.scanned, 1);

    let missing = root.path().join("missing");
    let unavailable = HookSpool::new(missing, FakeSink::default(), 1)
        .expect("absolute spool")
        .drain_once()
        .await;
    assert_eq!(
        unavailable.diagnostics,
        vec![HookDiagnostic::SpoolUnavailable]
    );
}

#[tokio::test]
async fn runtime_performs_startup_periodic_and_final_drains() {
    let root = TempDir::new().expect("spool root");
    publish(
        root.path(),
        "v1__codex__run-1__startup.hook",
        br#"{"hook_event_name":"SessionStart"}"#,
    );
    let spool = spool(&root, FakeSink::default(), DEFAULT_BATCH_SIZE);

    let (startup, runtime) = spool
        .start(Duration::from_millis(10))
        .await
        .expect("start spool runtime");
    assert_eq!(startup.accepted, 1);

    let periodic = publish(
        root.path(),
        "v1__codex__run-1__periodic.hook",
        br#"{"hook_event_name":"PreToolUse"}"#,
    );
    for _ in 0..50 {
        if !periodic.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(!periodic.exists());

    publish(
        root.path(),
        "v1__codex__run-1__final.hook",
        br#"{"hook_event_name":"Stop"}"#,
    );
    let final_report = runtime.shutdown().await;
    assert_eq!(final_report.accepted, 1);
}

#[tokio::test]
async fn a_required_drain_needs_the_root_startup_prepares_for_a_clean_profile() {
    let data_directory = TempDir::new().expect("data directory");
    let root = crate::terminal_lifecycle::hook_spool_directory(data_directory.path());
    let _ = fs::remove_dir_all(&root);
    let spool = HookSpool::new(root.clone(), FakeSink::default(), DEFAULT_BATCH_SIZE)
        .expect("absolute spool");

    // A clean profile reaches startup with no root at all, so the required
    // initial drain cannot run until the launch sequence has prepared one.
    let unavailable = spool
        .drain_required()
        .await
        .expect_err("an unprepared spool root");
    assert_eq!(unavailable.diagnostic(), HookDiagnostic::SpoolUnavailable);

    crate::terminal_lifecycle::ensure_hook_spool_directory(data_directory.path())
        .expect("prepare the spool root");

    let report = spool.drain_required().await.expect("a prepared spool root");
    assert_eq!(report.scanned, 0);
    assert!(report.diagnostics.is_empty(), "{:?}", report.diagnostics);
    let _ = fs::remove_dir_all(&root);
}
