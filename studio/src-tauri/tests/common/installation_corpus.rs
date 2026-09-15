//! Materialize the checked installation corpus for classification tests.
//!
//! Current fixtures are built from the checked Django schema and ledger that
//! production provisioning verifies. Each test receives its own installation.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// Files one SQLite installation is stored in.
pub const DATABASE_FILES: [&str; 3] = ["state.db", "state.db-wal", "state.db-shm"];

pub fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve repository root")
}

/// Copy one corpus fixture into a fresh data directory.
pub fn install(fixture: &str) -> tempfile::TempDir {
    let destination = tempfile::tempdir().expect("create an installation directory");
    let path = destination.path().to_owned();
    let fixture = fixture.to_owned();
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build fixture runtime")
            .block_on(async {
                match fixture.as_str() {
                    "django-current" | "current-small" | "current-representative" => {
                        super::execution_legacy_fixture::provision_current(&path).await;
                        std::fs::create_dir(path.join("media"))
                            .expect("create the fixture media root");
                    }
                    "current-wal" => provision_wal_fixture(&path).await,
                    _ => panic!("the checked Rust fixture does not materialize {fixture}"),
                }
            });
    })
    .join()
    .expect("build the installation fixture");
    destination
}

async fn provision_wal_fixture(destination: &Path) {
    use sea_orm::{ConnectionTrait, Database};

    let source = tempfile::tempdir().expect("create the WAL fixture source");
    super::execution_legacy_fixture::provision_current(source.path()).await;
    let database = Database::connect(format!(
        "sqlite:{}?mode=rw",
        source.path().join("state.db").display()
    ))
    .await
    .expect("open the WAL fixture source");
    database
        .execute_unprepared(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; \
             UPDATE worktracker_issue SET updated_at='2026-08-20 00:00:00' \
             WHERE id=(SELECT id FROM worktracker_issue LIMIT 1);",
        )
        .await
        .expect("commit fixture content into the write-ahead log");
    for name in ["state.db", "state.db-wal"] {
        std::fs::copy(source.path().join(name), destination.join(name))
            .unwrap_or_else(|error| panic!("copy WAL fixture {name}: {error}"));
    }
    database
        .close()
        .await
        .expect("close the WAL fixture source");
}

/// Run SQL against an installation, for the drifted and lookalike cases.
pub async fn execute(data_directory: &Path, sql: &str) {
    mutate(data_directory, sql, "").await;
}

/// Run SQL with the writer's own constraint enforcement relaxed.
///
/// A semantically defective installation is one whose rows already violate a
/// rule the schema states, which is exactly what a constrained writer refuses to
/// create. Django wrote these tables with foreign keys and check constraints
/// declared but not always enforced, so relaxing them here reproduces the
/// database a user actually arrives with rather than one this harness could
/// build.
pub async fn execute_unconstrained(data_directory: &Path, sql: &str) {
    mutate(
        data_directory,
        sql,
        "PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;",
    )
    .await;
}

async fn mutate(data_directory: &Path, sql: &str, relaxations: &str) {
    use sea_orm::{ConnectionTrait, Database};

    let database = Database::connect(format!(
        "sqlite:{}?mode=rw",
        data_directory.join("state.db").display()
    ))
    .await
    .expect("open the installation for a fixture mutation");
    if !relaxations.is_empty() {
        database
            .execute_unprepared(relaxations)
            .await
            .expect("relax the writer's constraint enforcement");
    }
    database
        .execute_unprepared(sql)
        .await
        .expect("apply the fixture mutation");
    database.close().await.expect("close the mutated fixture");
}

/// The installation's stored bytes are the bytes it arrived with.
///
/// A file absent before is not compared: SQLite creates an empty log and a
/// shared-memory index beside a write-ahead-log database for any reader, which
/// [`assert_no_new_durable_artifact`] accounts for instead.
pub fn assert_stored_bytes_unchanged(
    data_directory: &Path,
    before: &[(String, Option<Vec<u8>>)],
    while_doing: &str,
) {
    let after = database_bytes(data_directory);
    for ((name, before_bytes), (_, after_bytes)) in before.iter().zip(after.iter()) {
        if name == "state.db-shm" || before_bytes.is_none() {
            continue;
        }
        assert_eq!(
            before_bytes, after_bytes,
            "{name} changed while {while_doing}"
        );
    }
}

/// Nothing was added to the installation except SQLite's own scratch sidecars,
/// which any reader of a write-ahead-log database creates. The shared-memory
/// index is rebuilt from the log on demand; a log this reader brought into
/// existence must be empty, because a read-only connection cannot commit.
pub fn assert_no_new_durable_artifact(data_directory: &Path, before: &[String], while_doing: &str) {
    for entry in directory_entries(data_directory) {
        if before.contains(&entry) {
            continue;
        }
        assert!(
            entry == "state.db-shm" || entry == "state.db-wal",
            "{while_doing} produced an external effect: {entry}"
        );
        if entry == "state.db-wal" {
            assert_eq!(
                std::fs::metadata(data_directory.join(&entry))
                    .expect("read the new write-ahead log")
                    .len(),
                0,
                "{while_doing} committed content to {entry}"
            );
        }
    }
}

/// The stored bytes of an installation's database files, for a no-effect check.
pub fn database_bytes(data_directory: &Path) -> Vec<(String, Option<Vec<u8>>)> {
    DATABASE_FILES
        .iter()
        .map(|name| {
            (
                (*name).to_owned(),
                std::fs::read(data_directory.join(name)).ok(),
            )
        })
        .collect()
}

/// Every entry in the data directory, so a new durable artifact is visible.
pub fn directory_entries(data_directory: &Path) -> Vec<String> {
    let mut entries = std::fs::read_dir(data_directory)
        .expect("read the installation directory")
        .map(|entry| {
            entry
                .expect("read an installation entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
}
