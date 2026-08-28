//! Every supported installation is classified exactly, and nothing else is.
//!
//! The corpus these cases run against is built from Ticketry's real migrations,
//! so a classification here is evidence about the databases users actually have
//! rather than about a description of them.

mod common;

use common::installation_corpus as corpus;
use muxed_studio_lib::installation::classification::{
    self as classification, manifest, Installation, Refusal,
};

#[tokio::test]
async fn every_corpus_fixture_receives_its_recorded_classification() {
    let manifest = manifest();
    assert!(
        manifest.corpus.len() >= manifest.generations.len(),
        "the corpus must materialize at least one fixture per generation"
    );
    for fixture in &manifest.corpus {
        let installation = corpus::install(&fixture.name);
        let classified = classification::classify(installation.path())
            .await
            .unwrap_or_else(|error| panic!("{} must classify: {error}", fixture.name));
        let generation = manifest
            .generation(&fixture.generation)
            .unwrap_or_else(|| panic!("{} names an unrecorded generation", fixture.name));
        assert_eq!(
            classified.generation(),
            generation.name,
            "{} classified as the wrong generation",
            fixture.name
        );
        match (generation.expected.as_str(), &classified) {
            ("adopt", Installation::SqliteCurrent(recorded))
            | ("bridge", Installation::SqliteHistorical(recorded)) => {
                assert_eq!(recorded.fingerprint, generation.fingerprint);
                assert_eq!(recorded.applied_migrations, generation.applied.len());
            }
            (expected, other) => {
                panic!(
                    "{} expected {expected} but classified as {other:?}",
                    fixture.name
                )
            }
        }
    }
}

#[test]
fn the_manifest_records_every_migration_on_disk() {
    // The manifest is Ticketry's support policy. A migration added without
    // regenerating it would silently move the current leaf out from under
    // classification, so the mismatch is named here rather than diagnosed from
    // an unsupported-generation refusal elsewhere.
    let manifest = manifest();
    for (app, steps) in &manifest.migration_graph {
        let directory = if app == "worktracker" {
            corpus::repository_root().join("backend/worktracker/migrations")
        } else {
            corpus::repository_root().join(format!("backend/apps/{app}/migrations"))
        };
        let mut on_disk = std::fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("read {}: {error}", directory.display()))
            .filter_map(|entry| {
                let name = entry.expect("read a migration entry").file_name();
                let name = name.to_string_lossy().into_owned();
                (name.ends_with(".rs") || name.ends_with(".py"))
                    .then(|| name.trim_end_matches(".py").to_owned())
            })
            .filter(|name| name != "__init__")
            .collect::<Vec<_>>();
        on_disk.sort();
        let mut recorded = steps
            .iter()
            .map(|step| step.name.clone())
            .collect::<Vec<_>>();
        recorded.sort();
        assert_eq!(
            recorded, on_disk,
            "{app} migrations changed; regenerate the manifest with \
             `backend/.venv/bin/python scripts/installation_corpus.py emit-manifest \
             studio/src-tauri/src/installation/classification/manifest.v1.json`"
        );
    }
}

#[tokio::test]
async fn the_current_django_leaf_is_directly_adoptable() {
    let installation = corpus::install("django-current");

    let classified = classification::classify(installation.path())
        .await
        .expect("the current Django leaf must classify");

    let Installation::SqliteCurrent(generation) = classified else {
        panic!("the current Django leaf must be directly adoptable, got {classified:?}");
    };
    assert_eq!(generation.name, manifest().current_generation);
    assert_eq!(
        generation.applied_migrations,
        manifest().current().applied.len()
    );
}

#[tokio::test]
async fn a_pending_write_ahead_log_is_read_as_committed_content() {
    // This fixture's main database file is a whole generation behind its log:
    // the retired capabilities' migrations are committed only in the WAL. A
    // classifier that skipped the log would answer confidently and wrongly.
    let installation = corpus::install("current-wal");
    assert!(
        installation
            .path()
            .join("state.db-wal")
            .metadata()
            .unwrap()
            .len()
            > 0,
        "the fixture must carry a pending write-ahead log"
    );

    let classified = classification::classify(installation.path())
        .await
        .expect("a pending log must not stop classification");

    assert_eq!(classified.generation(), manifest().current_generation);
    assert!(matches!(classified, Installation::SqliteCurrent(_)));
}

#[tokio::test]
async fn seeded_content_does_not_change_the_answer() {
    for fixture in ["django-current", "current-small", "current-representative"] {
        let installation = corpus::install(fixture);
        let classified = classification::classify(installation.path())
            .await
            .unwrap_or_else(|error| panic!("{fixture} must classify: {error}"));
        assert!(
            matches!(classified, Installation::SqliteCurrent(_)),
            "{fixture} classified as {classified:?}"
        );
    }
}

#[tokio::test]
async fn an_empty_installation_classifies_idempotently() {
    let directory = tempfile::tempdir().expect("create an empty data directory");

    assert_eq!(
        classification::classify(directory.path()).await.unwrap(),
        Installation::Empty
    );
    assert_eq!(
        classification::classify(directory.path()).await.unwrap(),
        Installation::Empty
    );
    assert!(corpus::directory_entries(directory.path()).is_empty());

    // An interrupted first launch leaves a zero-length file behind. That is an
    // empty installation too, not an unknown schema.
    std::fs::write(directory.path().join("state.db"), b"").expect("stage an empty database");
    assert_eq!(
        classification::classify(directory.path()).await.unwrap(),
        Installation::Empty
    );
}

#[tokio::test]
async fn an_already_rust_owned_installation_classifies_idempotently() {
    let installation = corpus::install("django-current");
    muxed_studio_lib::work_management::adoption::adopt(installation.path())
        .await
        .expect("adopt Work Management, so Rust owns the installation");

    let first = classification::classify(installation.path())
        .await
        .expect("an adopted installation must classify");
    let second = classification::classify(installation.path())
        .await
        .expect("reopening an adopted installation must classify the same way");

    assert_eq!(first, second);
    let Installation::RustOwned(ownership) = first else {
        panic!("an adopted installation must be Rust-owned, got {second:?}");
    };
    assert_eq!(ownership.adopted, vec!["ticketry_worktracker_adoption"]);
    assert!(
        ownership
            .pending
            .contains(&"ticketry_runs_adoption".to_owned()),
        "capabilities that have not handed over yet are reported as pending"
    );
}

#[tokio::test]
async fn a_refused_installation_is_left_byte_for_byte_unchanged() {
    let installation = corpus::install("current-representative");
    corpus::execute(
        installation.path(),
        "ALTER TABLE worktracker_issue ADD COLUMN unreviewed_column varchar(32) NULL",
    )
    .await;
    let before = corpus::database_bytes(installation.path());
    let entries_before = corpus::directory_entries(installation.path());

    let refusal = classification::classify(installation.path())
        .await
        .expect_err("a lookalike schema must be refused");

    assert_eq!(refusal.reason(), Refusal::LedgerDisagreesWithSchema);
    corpus::assert_stored_bytes_unchanged(installation.path(), &before, "classifying");
    corpus::assert_no_new_durable_artifact(installation.path(), &entries_before, "classification");
}

#[tokio::test]
async fn an_accepted_installation_is_also_left_unchanged() {
    let installation = corpus::install("current-wal");
    let before = corpus::database_bytes(installation.path());
    let entries_before = corpus::directory_entries(installation.path());

    classification::classify(installation.path())
        .await
        .expect("the fixture must classify");

    corpus::assert_stored_bytes_unchanged(installation.path(), &before, "classifying");
    corpus::assert_no_new_durable_artifact(installation.path(), &entries_before, "classification");
}

#[tokio::test]
async fn a_close_lookalike_is_refused_by_name() {
    let installation = corpus::install("django-current");
    corpus::execute(
        installation.path(),
        "CREATE TABLE worktracker_shadow_issue (id char(32) NOT NULL PRIMARY KEY)",
    )
    .await;

    let refusal = classification::classify(installation.path())
        .await
        .expect_err("an unknown product table must be refused");

    assert_eq!(refusal.reason(), Refusal::LedgerDisagreesWithSchema);
    assert!(
        refusal.detail().contains("worktracker_shadow_issue"),
        "the refusal must name the unknown table: {}",
        refusal.detail()
    );
}

#[tokio::test]
async fn a_partial_migration_ledger_is_refused() {
    let installation = corpus::install("django-current");
    // A migration run interrupted between two steps leaves a ledger that no
    // longer contains everything its own rows depend on.
    corpus::execute(
        installation.path(),
        "DELETE FROM django_migrations WHERE app = 'worktracker' AND name = '0006_issue_rank'",
    )
    .await;

    let refusal = classification::classify(installation.path())
        .await
        .expect_err("a partial migration ledger must be refused");

    assert_eq!(refusal.reason(), Refusal::PartialMigrationLedger);
    assert!(refusal.detail().contains("worktracker.0006_issue_rank"));
}

#[tokio::test]
async fn an_unsupported_generation_is_refused() {
    let installation = corpus::install("django-current");
    let leaf = manifest()
        .migration_graph
        .get("worktracker")
        .and_then(|steps| steps.last())
        .expect("the manifest records the WorkTracker chain")
        .name
        .clone();
    corpus::execute(
        installation.path(),
        &format!("DELETE FROM django_migrations WHERE app = 'worktracker' AND name = '{leaf}'"),
    )
    .await;

    let refusal = classification::classify(installation.path())
        .await
        .expect_err("a ledger matching no recorded generation must be refused");

    assert_eq!(refusal.reason(), Refusal::UnsupportedGeneration);
}

#[tokio::test]
async fn a_future_django_generation_is_refused() {
    let installation = corpus::install("django-current");
    corpus::execute(
        installation.path(),
        "INSERT INTO django_migrations (app, name, applied) \
         VALUES ('worktracker', '9999_written_by_a_newer_release', '2026-08-22 09:00:00')",
    )
    .await;

    let refusal = classification::classify(installation.path())
        .await
        .expect_err("evidence from a newer release must be refused");

    assert_eq!(refusal.reason(), Refusal::FutureGeneration);
}

#[tokio::test]
async fn a_future_rust_ownership_version_is_refused() {
    let installation = corpus::install("django-current");
    muxed_studio_lib::work_management::adoption::adopt(installation.path())
        .await
        .expect("adopt Work Management first");
    corpus::execute(
        installation.path(),
        "UPDATE ticketry_worktracker_adoption SET version = version + 1 WHERE singleton = 1",
    )
    .await;

    let refusal = classification::classify(installation.path())
        .await
        .expect_err("a newer ownership version must be refused");

    assert_eq!(refusal.reason(), Refusal::FutureGeneration);
}

#[tokio::test]
async fn product_tables_without_a_migration_ledger_are_refused() {
    let installation = corpus::install("django-current");
    corpus::execute(installation.path(), "DROP TABLE django_migrations").await;

    let refusal = classification::classify(installation.path())
        .await
        .expect_err("product tables with no ledger must be refused");

    assert_eq!(refusal.reason(), Refusal::UnknownSchema);
}

#[tokio::test]
async fn a_postgresql_installation_is_an_import_source_and_is_not_opened() {
    let directory = tempfile::tempdir().expect("create a PostgreSQL data directory");
    std::fs::write(
        directory.path().join("database-url"),
        "postgresql://ticketry:secret@127.0.0.1:5432/ticketry\n",
    )
    .expect("stage the marker");
    std::fs::write(directory.path().join("database-url.enabled"), "1")
        .expect("stage the marker gate");

    let classified = classification::classify(directory.path())
        .await
        .expect("a PostgreSQL installation must classify");

    let Installation::PostgresImportSource(source) = classified else {
        panic!("a PostgreSQL installation must be an import source, got {classified:?}");
    };
    assert_eq!(source.scheme, "postgresql");
    let recorded = serde_json::to_string(&source).expect("serialize the source");
    assert!(
        !recorded.contains("secret"),
        "credentials must never reach an adoption record: {recorded}"
    );
}

#[tokio::test]
async fn an_unsupported_declared_engine_is_refused() {
    let directory = tempfile::tempdir().expect("create a data directory");
    std::fs::write(
        directory.path().join("database-url"),
        "mysql://127.0.0.1/ticketry\n",
    )
    .expect("stage the marker");
    std::fs::write(directory.path().join("database-url.enabled"), "1")
        .expect("stage the marker gate");

    let refusal = classification::classify(directory.path())
        .await
        .expect_err("an unsupported engine must be refused");

    assert_eq!(refusal.reason(), Refusal::UnknownSchema);
}

#[tokio::test]
async fn a_symlinked_installation_is_refused_before_it_is_opened() {
    let real = corpus::install("django-current");
    let parent = tempfile::tempdir().expect("create a link directory");
    let link = parent.path().join("data");
    std::os::unix::fs::symlink(real.path(), &link).expect("link the data directory");

    let refusal = classification::classify(&link)
        .await
        .expect_err("a symlinked data directory must be refused");

    assert_eq!(refusal.reason(), Refusal::UnsafeInstallationPath);
}
