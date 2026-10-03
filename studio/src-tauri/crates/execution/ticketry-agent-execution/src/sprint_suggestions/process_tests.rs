use super::{process, test_fixture::*};
use sea_orm::ConnectionTrait;

#[cfg(unix)]
pub(super) async fn script(directory: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = directory.join("fake-codex");
    let output = serde_json::json!({"suggestions":[{"goal_id":GOAL,"story":{"kind":"existing","issue_id":STORY},"reason":"Fits"}]}).to_string();
    let source = format!("#!/bin/sh\nwhile [ $# -gt 0 ]; do\n if [ \"$1\" = --output-last-message ]; then shift; result=\"$1\"; fi\n shift\ndone\ncat >/dev/null\nprintf '%s' '{output}' > \"$result\"\n{suffix}\n");
    tokio::fs::write(&path, source).await.unwrap();
    tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
        .await
        .unwrap();
    path
}
#[tokio::test]
#[cfg(unix)]
async fn typed_result_comes_from_the_result_file_and_nonzero_exit_is_failure() {
    for exit in ["exit 0", "exit 42"] {
        let (db, dir) = fixture().await;
        let (service, job, snapshot) = running(&db, dir.path()).await;
        let program = script(dir.path(), exit).await;
        let result = process::run_in(&service, &job, &snapshot, dir.path(), &program).await;
        if exit == "exit 0" {
            assert_eq!(result.unwrap().suggestions.len(), 1);
        } else {
            assert!(result.unwrap_err().contains("couldn't finish"));
        }
    }
}
#[tokio::test]
#[cfg(unix)]
async fn cancellation_stops_the_owned_process_without_waiting_for_its_exit() {
    let (db, dir) = fixture().await;
    let (service, job, snapshot) = running(&db, dir.path()).await;
    let program = script(dir.path(), "exec sleep 30").await;
    db.execute_unprepared("UPDATE agent_executions SET state='cancelled', cancel_requested=1")
        .await
        .unwrap();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        process::run_in(&service, &job, &snapshot, dir.path(), &program),
    )
    .await
    .unwrap();
    assert_eq!(result.unwrap_err(), "Cancelled.");
}
