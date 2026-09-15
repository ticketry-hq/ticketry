//! Startup validates current stores without rebuilding migration evidence.
use sea_orm::{ConnectionTrait, Database};

async fn ensure_all(path: &std::path::Path) {
    ticketry_work_management::ensure_adopted(path)
        .await
        .unwrap();
    ticketry_runs::ensure_adopted(path).await.unwrap();
    ticketry_terminal::ensure_terminal_persistence_adopted(path)
        .await
        .unwrap();
    ticketry_agent_execution::ensure_adopted(path)
        .await
        .unwrap();
}

async fn evidence(path: &std::path::Path) -> serde_json::Value {
    serde_json::json!({
        "work": ticketry_work_management::adoption::adopt(path).await.unwrap(),
        "runs": ticketry_runs::adopt(path).await.unwrap(),
        "terminal": ticketry_terminal::adopt_terminal_persistence(path).await.unwrap(),
        "execution": ticketry_agent_execution::persistence::adopt(path).await.unwrap(),
    })
}

#[tokio::test]
async fn startup_migrates_then_reopens_without_changing_history_or_evidence() {
    let directory = tempfile::tempdir().unwrap();
    ticketry_installation::provision(directory.path())
        .await
        .unwrap();
    ensure_all(directory.path()).await;
    let before = evidence(directory.path()).await;
    ensure_all(directory.path()).await;
    assert_eq!(before, evidence(directory.path()).await);
}

#[tokio::test]
async fn startup_reopen_still_rejects_damaged_owned_schemas() {
    for table in [
        "worktracker_issue",
        "agent_runs",
        "agent_terminal_sessions",
        "graph_runs",
    ] {
        let directory = tempfile::tempdir().unwrap();
        ticketry_installation::provision(directory.path())
            .await
            .unwrap();
        ensure_all(directory.path()).await;
        let database = Database::connect(format!(
            "sqlite:{}?mode=rw",
            directory.path().join("state.db").display()
        ))
        .await
        .unwrap();
        database
            .execute_unprepared("PRAGMA foreign_keys=OFF")
            .await
            .unwrap();
        database
            .execute_unprepared(&format!("DROP TABLE {table}"))
            .await
            .unwrap();
        database.close().await.unwrap();
        let refused = match table {
            "worktracker_issue" => ticketry_work_management::ensure_adopted(directory.path())
                .await
                .is_err(),
            "agent_runs" => ticketry_runs::ensure_adopted(directory.path())
                .await
                .is_err(),
            "agent_terminal_sessions" => {
                ticketry_terminal::ensure_terminal_persistence_adopted(directory.path())
                    .await
                    .is_err()
            }
            _ => ticketry_agent_execution::ensure_adopted(directory.path())
                .await
                .is_err(),
        };
        assert!(refused, "startup accepted missing {table}");
    }
}

/// Run against an isolated SQLite backup, never the live application directory.
#[tokio::test]
#[ignore = "requires TICKETRY_STARTUP_BENCH_DIR containing an isolated adopted database"]
async fn compare_adoption_startup_cost() {
    let directory =
        std::path::PathBuf::from(std::env::var_os("TICKETRY_STARTUP_BENCH_DIR").unwrap());
    assert!(directory
        .canonicalize()
        .unwrap()
        .starts_with(std::env::temp_dir().canonicalize().unwrap()));
    for iteration in 0..3 {
        let started = std::time::Instant::now();
        ticketry_work_management::adoption::adopt(&directory)
            .await
            .unwrap();
        ticketry_runs::preflight(&directory).await.unwrap();
        ticketry_runs::adopt(&directory).await.unwrap();
        ticketry_terminal::preflight_terminal_persistence(&directory)
            .await
            .unwrap();
        ticketry_terminal::adopt_terminal_persistence(&directory)
            .await
            .unwrap();
        ticketry_agent_execution::persistence::preflight(&directory)
            .await
            .unwrap();
        ticketry_agent_execution::persistence::adopt(&directory)
            .await
            .unwrap();
        let before = started.elapsed();
        let started = std::time::Instant::now();
        ensure_all(&directory).await;
        eprintln!(
            "adoption comparison {iteration}: before={}ms after={}ms",
            before.as_millis(),
            started.elapsed().as_millis()
        );
    }
}

#[tokio::test]
#[ignore = "requires TICKETRY_STARTUP_BENCH_DIR containing an isolated adopted database"]
async fn installation_reopen_cost() {
    let directory =
        std::path::PathBuf::from(std::env::var_os("TICKETRY_STARTUP_BENCH_DIR").unwrap());
    for _ in 0..2 {
        let started = std::time::Instant::now();
        ticketry_installation::adopt(&directory).await.unwrap();
        eprintln!(
            "TIMING installation.adopt total {}ms",
            started.elapsed().as_millis()
        );
    }
}
