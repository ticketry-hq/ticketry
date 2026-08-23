//! Materialize the checked installation corpus for classification tests.
//!
//! Every fixture is built by `scripts/installation_corpus.py`, which runs the
//! real Django migrations rather than describing their result. The whole corpus
//! is built once per test binary and then copied per case, so a test can mutate
//! its own installation freely without disturbing the shared build.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// Files one SQLite installation is stored in.
pub const DATABASE_FILES: [&str; 3] = ["state.db", "state.db-wal", "state.db-shm"];

pub fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve repository root")
}

/// Build the whole corpus once, and return the directory holding it.
pub fn corpus() -> &'static Path {
    static CORPUS: OnceLock<PathBuf> = OnceLock::new();
    CORPUS.get_or_init(|| {
        let directory = std::env::temp_dir().join(format!(
            "ticketry-installation-corpus-{}",
            std::process::id()
        ));
        let output = Command::new(repository_root().join("backend/.venv/bin/python"))
            .arg(repository_root().join("scripts/installation_corpus.py"))
            .arg("materialize")
            .arg(&directory)
            .current_dir(repository_root())
            .output()
            .expect("run the installation corpus builder");
        assert!(
            output.status.success(),
            "installation corpus build failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        directory
    })
}

/// Copy one corpus fixture into a fresh data directory.
pub fn install(fixture: &str) -> tempfile::TempDir {
    let source = corpus().join(fixture);
    assert!(
        source.join("state.db").is_file(),
        "the corpus has no fixture named {fixture}"
    );
    let destination = tempfile::tempdir().expect("create an installation directory");
    copy_tree(&source, destination.path());
    destination
}

fn copy_tree(source: &Path, destination: &Path) {
    for entry in std::fs::read_dir(source).expect("read a corpus fixture") {
        let entry = entry.expect("read a corpus fixture entry");
        let target = destination.join(entry.file_name());
        if entry
            .file_type()
            .expect("classify a fixture entry")
            .is_dir()
        {
            std::fs::create_dir_all(&target).expect("create a fixture subdirectory");
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("copy a fixture file");
        }
    }
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
        if before_bytes.is_none() {
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
