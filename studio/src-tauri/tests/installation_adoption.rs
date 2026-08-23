//! Adoption of a current SQLite installation, and of an empty data directory.
//!
//! The corpus these cases run against is built from Ticketry's real migrations,
//! so "everything a user has is still there afterwards" is evidence about the
//! databases users actually hold rather than about a fixture written to pass.
//! The write-ahead-log case is the load-bearing one: its most recent committed
//! rows live outside the database file, which is exactly the content a copy
//! that skipped the checkpoint would silently drop.

mod common;

use std::path::Path;

use common::installation_corpus as corpus;
use muxed_studio_lib::installation_adoption::{
    self as adoption, AdoptionPath, AdoptionPlan, Completion, Phase, Readiness, Refusal,
};
use muxed_studio_lib::installation_classification::{self as classification, Installation};

/// Read one scalar out of an installation, for the preservation assertions.
async fn scalar(data_directory: &Path, query: &str) -> String {
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        data_directory.join("state.db").display()
    ))
    .await
    .expect("open the installation for a read");
    let row = database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .expect("run the read")
        .expect("the read returned a row");
    let value = row
        .try_get_by_index::<Option<String>>(0)
        .expect("read the value")
        .unwrap_or_default();
    database.close().await.expect("close the read connection");
    value
}

async fn django_migration_provenance(data_directory: &Path) -> String {
    if scalar(
        data_directory,
        "SELECT CAST(COUNT(*) AS TEXT) FROM sqlite_master WHERE type='table' AND name='django_migrations'",
    )
    .await
        == "0"
    {
        return "absent".to_owned();
    }
    scalar(
        data_directory,
        "SELECT group_concat(app || '.' || name, '|') FROM (SELECT app, name FROM django_migrations ORDER BY app, name)",
    )
    .await
}

/// Run the sequence production runs: adopt, hand the capabilities over, open.
///
/// The Runs handoff sits between the two adoption calls because it is what
/// provisions the durable status-event ledger the boundary is published into.
/// A test that skipped it would prove the boundary against a ledger no shipping
/// installation has at that point.
async fn adopt_and_open(data_directory: &Path) -> adoption::Adoption {
    let adopted = adoption::adopt(data_directory)
        .await
        .expect("the installation must adopt");
    assert_eq!(
        adopted.readiness,
        Readiness::Closed,
        "readiness must stay closed until the boundary is published"
    );
    muxed_studio_lib::runs_persistence::adopt(data_directory)
        .await
        .expect("the Runs capability must hand over");
    adoption::open_readiness(data_directory, adopted)
        .await
        .expect("readiness must open")
}

async fn ledger(data_directory: &Path) -> adoption::LedgerRow {
    use sea_orm::Database;

    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        data_directory.join("state.db").display()
    ))
    .await
    .expect("open the installation to read its ledger");
    let row = adoption::ledger::read(&database)
        .await
        .expect("the ledger must be readable")
        .expect("an adopted installation carries a ledger");
    database.close().await.expect("close the ledger connection");
    row
}

// ---------------------------------------------------------------------------
// A current installation is adopted losslessly
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_current_installation_is_adopted_and_readiness_opens() {
    let installation = corpus::install("current-representative");
    let adopted = adopt_and_open(installation.path()).await;

    assert_eq!(adopted.path, AdoptionPath::Adopted);
    assert_eq!(adopted.generation, "django-current");
    assert_eq!(adopted.readiness, Readiness::Open);
    assert_eq!(adopted.rust_leaf, adoption::RUST_LEAF);
    assert!(
        adopted.counts.values().sum::<u64>() > 0,
        "the representative fixture must carry content to preserve"
    );
    assert!(
        adoption::Adoption::evidence_path(installation.path()).is_file(),
        "adoption must leave evidence beside the installation"
    );
}

#[tokio::test]
async fn every_product_identity_and_value_survives_adoption() {
    let installation = corpus::install("current-representative");
    let digest_query = "SELECT group_concat(quote(id) || quote(sequence_id) || quote(rank) || \
                        quote(state_revision) || quote(parent_id) || quote(state_id), '|') \
                        FROM (SELECT * FROM worktracker_issue ORDER BY id)";
    let before = scalar(installation.path(), digest_query).await;
    let documents = scalar(
        installation.path(),
        "SELECT group_concat(quote(id) || quote(rel_path) || quote(root_dir), '|') \
         FROM (SELECT * FROM design_documents ORDER BY id)",
    )
    .await;
    let runs = scalar(
        installation.path(),
        "SELECT group_concat(quote(id) || quote(started_at) || quote(lifecycle_state), '|') \
         FROM (SELECT * FROM agent_runs ORDER BY id)",
    )
    .await;

    adopt_and_open(installation.path()).await;

    assert_eq!(
        before,
        scalar(installation.path(), digest_query).await,
        "work item identities, sequence ids, ranks, revisions, parents, and states must survive"
    );
    assert_eq!(
        documents,
        scalar(
            installation.path(),
            "SELECT group_concat(quote(id) || quote(rel_path) || quote(root_dir), '|') \
             FROM (SELECT * FROM design_documents ORDER BY id)"
        )
        .await,
        "document identities and paths must survive"
    );
    assert_eq!(
        runs,
        scalar(
            installation.path(),
            "SELECT group_concat(quote(id) || quote(started_at) || quote(lifecycle_state), '|') \
             FROM (SELECT * FROM agent_runs ORDER BY id)"
        )
        .await,
        "durable run identities and timestamps must survive"
    );
}

#[tokio::test]
async fn write_ahead_log_content_reaches_both_the_snapshot_and_the_adopted_database() {
    let installation = corpus::install("current-wal");
    assert!(
        std::fs::metadata(installation.path().join("state.db-wal"))
            .expect("the fixture must carry a write-ahead log")
            .len()
            > 0,
        "the fixture must carry pending committed content"
    );
    let issues = scalar(
        installation.path(),
        "SELECT CAST(COUNT(*) AS TEXT) FROM worktracker_issue",
    )
    .await;

    let adopted = adopt_and_open(installation.path()).await;

    assert_eq!(
        issues,
        scalar(
            installation.path(),
            "SELECT CAST(COUNT(*) AS TEXT) FROM worktracker_issue"
        )
        .await,
        "committed rows that were in the log must be in the adopted database"
    );
    let snapshot = adopted.snapshot.expect("adoption must create a snapshot");
    assert!(
        snapshot.verified,
        "the snapshot must be independently proven"
    );
    let copied = installation.path().join(&snapshot.file);
    assert!(copied.is_file(), "the recovery snapshot must exist");
    // The snapshot is a database in its own right: opening it must show the
    // same rows, which is what "the WAL reached the recovery copy" means.
    let restored = tempfile::tempdir().expect("create a restore directory");
    std::fs::copy(&copied, restored.path().join("state.db")).expect("restore the snapshot");
    assert_eq!(
        issues,
        scalar(
            restored.path(),
            "SELECT CAST(COUNT(*) AS TEXT) FROM worktracker_issue"
        )
        .await,
        "committed rows that were in the log must be in the verified recovery copy"
    );
}

#[tokio::test]
async fn the_ledger_records_the_source_the_snapshot_and_the_leaf() {
    let installation = corpus::install("current-small");
    let adopted = adopt_and_open(installation.path()).await;
    let row = ledger(installation.path()).await;

    assert_eq!(row.source_generation, "django-current");
    assert_eq!(row.source_fingerprint.len(), 64);
    assert_eq!(row.rust_leaf, adoption::RUST_LEAF);
    assert_eq!(row.completion, Completion::Ready);
    assert_eq!(
        row.snapshot_sha256.as_deref(),
        adopted
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.sha256.as_str()),
        "the ledger and the evidence must name the same recovery point"
    );
    assert!(
        row.counts.contains_key("worktracker_issue"),
        "the ledger must record what the installation contained"
    );
    assert!(
        !row.application_version.is_empty(),
        "the ledger must record which release adopted the installation"
    );
}

#[tokio::test]
async fn a_new_authoritative_event_boundary_is_published_without_replaying_history() {
    let installation = corpus::install("current-representative");
    let adopted = adoption::adopt(installation.path())
        .await
        .expect("a current installation must adopt");
    muxed_studio_lib::runs_persistence::adopt(installation.path())
        .await
        .expect("the Runs capability must hand over");
    // Counted after the handoff and before the boundary: this is every event
    // the installation carried into the Rust era.
    let historical_before = scalar(
        installation.path(),
        "SELECT CAST(COUNT(*) AS TEXT) FROM runs_status_events",
    )
    .await;

    let ready = adoption::open_readiness(installation.path(), adopted)
        .await
        .expect("readiness must open");

    let boundary = ready
        .event_boundary
        .expect("an installation with projects must receive a boundary");
    assert_eq!(
        scalar(
            installation.path(),
            "SELECT CAST(COUNT(*) AS TEXT) FROM runs_status_events \
             WHERE event_kind = 'installation.adopted'",
        )
        .await,
        boundary.projects.len().to_string(),
        "exactly one boundary event per project is published"
    );
    assert!(
        !boundary.projects.is_empty(),
        "the representative fixture must carry at least one project"
    );
    assert_eq!(
        scalar(
            installation.path(),
            "SELECT CAST(COUNT(*) AS TEXT) FROM runs_status_events \
             WHERE event_kind <> 'installation.adopted'",
        )
        .await,
        historical_before,
        "no historical event may be republished as new work"
    );
    assert_eq!(
        scalar(
            installation.path(),
            "SELECT CAST(COUNT(*) AS TEXT) FROM runs_status_events \
             WHERE event_kind IN ('agent_run.lifecycle', 'agent_run.terminal') \
               AND cursor > CAST((SELECT MIN(cursor) FROM runs_status_events \
                                  WHERE event_kind = 'installation.adopted') AS INTEGER)",
        )
        .await,
        "0",
        "nothing historical may be replayed after the boundary"
    );
}

// ---------------------------------------------------------------------------
// Reopening is idempotent
// ---------------------------------------------------------------------------

#[tokio::test]
async fn reopening_an_adopted_installation_changes_nothing() {
    let installation = corpus::install("current-representative");
    adopt_and_open(installation.path()).await;
    let first = ledger(installation.path()).await;
    let events = scalar(
        installation.path(),
        "SELECT CAST(COUNT(*) AS TEXT) FROM runs_status_events",
    )
    .await;
    let snapshots = corpus::directory_entries(installation.path());

    let reopened = adopt_and_open(installation.path()).await;

    assert_eq!(reopened.path, AdoptionPath::Reopened);
    assert_eq!(reopened.readiness, Readiness::Open);
    assert!(
        reopened.snapshot.is_none(),
        "reopening must not rotate the pre-Rust recovery point out"
    );
    assert!(
        reopened.event_boundary.is_none(),
        "reopening must not publish a second boundary"
    );
    assert_eq!(
        first.adoption_id,
        ledger(installation.path()).await.adoption_id,
        "reopening must not start a second adoption"
    );
    assert_eq!(
        events,
        scalar(
            installation.path(),
            "SELECT CAST(COUNT(*) AS TEXT) FROM runs_status_events"
        )
        .await,
        "reopening must replay no automation, launch, or cleanup effect"
    );
    assert_eq!(
        snapshots,
        corpus::directory_entries(installation.path()),
        "reopening must produce no new durable artifact"
    );
}

// ---------------------------------------------------------------------------
// An empty installation is provisioned at the Rust leaf
// ---------------------------------------------------------------------------

#[tokio::test]
async fn an_empty_data_directory_is_provisioned_at_the_current_leaf() {
    let installation = tempfile::tempdir().expect("create an empty data directory");

    let provisioned = adopt_and_open(installation.path()).await;

    assert_eq!(provisioned.path, AdoptionPath::Provisioned);
    assert_eq!(provisioned.readiness, Readiness::Open);
    assert!(
        provisioned.snapshot.is_none(),
        "a first launch has no rows to protect"
    );
    assert_eq!(
        scalar(
            installation.path(),
            "SELECT CAST(COUNT(*) AS TEXT) FROM worktracker_workspace"
        )
        .await,
        "1",
        "a first launch provisions the one workspace it needs"
    );
    let row = ledger(installation.path()).await;
    assert_eq!(row.rust_leaf, adoption::RUST_LEAF);
    assert_eq!(row.completion, Completion::Ready);
    assert!(
        row.snapshot_file.is_none(),
        "provisioning records no recovery point because nothing was at risk"
    );
}

#[tokio::test]
async fn a_first_launch_exposes_the_shipping_provider_catalog() {
    let installation = tempfile::tempdir().expect("create an empty data directory");
    adopt_and_open(installation.path()).await;

    muxed_studio_lib::settings_persistence::preflight(installation.path())
        .await
        .expect("a first launch must include the provider catalog required by startup");

    let database =
        muxed_studio_lib::work_management::open_for_commands(&installation.path().join("state.db"))
            .await
            .expect("open the provisioned catalog");
    let catalog = muxed_studio_lib::settings_persistence::ProviderCatalogService::open(database)
        .await
        .expect("the provisioned providers must match the shipping adapters")
        .load()
        .await
        .expect("load the provisioned catalog");

    assert_eq!(
        catalog
            .providers
            .iter()
            .map(|provider| provider.slug.as_str())
            .collect::<Vec<_>>(),
        ["claude", "codex", "gemini"]
    );
    assert_eq!(
        catalog
            .agent_models
            .iter()
            .map(|model| model.name.as_str())
            .collect::<Vec<_>>(),
        [
            "vendor/model",
            "fable",
            "haiku",
            "opus",
            "sonnet",
            "gpt-5.4",
            "gemini-3.1-pro-preview",
        ]
    );
    assert_eq!(
        catalog
            .reasoning_levels
            .iter()
            .map(|level| level.name.as_str())
            .collect::<Vec<_>>(),
        ["high", "low", "max", "medium", "minimal", "xhigh"]
    );
}

#[tokio::test]
async fn a_provisioned_installation_reproduces_the_adopted_schema() {
    let provisioned = tempfile::tempdir().expect("create an empty data directory");
    adopt_and_open(provisioned.path()).await;
    let adopted = corpus::install("django-current");
    adopt_and_open(adopted.path()).await;

    // Both paths must arrive at one schema, or every later migration would
    // have two starting points to be correct against.
    assert_eq!(
        ledger(provisioned.path()).await.source_fingerprint,
        ledger(adopted.path()).await.source_fingerprint,
        "a provisioned installation and an adopted one must be the same shape"
    );
}

#[tokio::test]
async fn reopening_a_provisioned_installation_is_idempotent() {
    let installation = tempfile::tempdir().expect("create an empty data directory");
    adopt_and_open(installation.path()).await;
    let workspace = scalar(
        installation.path(),
        "SELECT group_concat(quote(id) || quote(slug), '|') FROM worktracker_workspace",
    )
    .await;

    let reopened = adopt_and_open(installation.path()).await;

    assert_eq!(reopened.path, AdoptionPath::Reopened);
    assert_eq!(
        workspace,
        scalar(
            installation.path(),
            "SELECT group_concat(quote(id) || quote(slug), '|') FROM worktracker_workspace"
        )
        .await,
        "a second launch must not provision a second workspace"
    );
}

// ---------------------------------------------------------------------------
// Refusals leave readiness closed and the source reusable
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_busy_installation_is_refused_before_anything_is_written() {
    use sea_orm::{ConnectionTrait, Database};

    let installation = corpus::install("current-small");
    let before = corpus::database_bytes(installation.path());
    // A second writer attached to the installation is what a Django or FastMCP
    // process that outlived its supervisor looks like from here.
    let competing = Database::connect(format!(
        "sqlite:{}?mode=rw",
        installation.path().join("state.db").display()
    ))
    .await
    .expect("attach a competing writer");
    competing
        .execute_unprepared("BEGIN EXCLUSIVE")
        .await
        .expect("the competing writer takes the installation");

    let failure = adoption::adopt(installation.path())
        .await
        .expect_err("a busy installation must be refused");

    assert_eq!(failure.refusal(), Refusal::InstallationBusy);
    assert_eq!(failure.phase(), Phase::WriterShutdown);
    assert!(failure.refusal().source_is_untouched());
    competing
        .execute_unprepared("ROLLBACK")
        .await
        .expect("release the competing writer");
    competing.close().await.expect("close the competing writer");
    corpus::assert_stored_bytes_unchanged(installation.path(), &before, "refusing a busy source");
}

#[tokio::test]
async fn a_semantically_defective_installation_is_refused_with_its_defects() {
    let installation = corpus::install("current-small");
    corpus::execute_unconstrained(
        installation.path(),
        "UPDATE worktracker_issue SET parent_id = id WHERE id = (SELECT id FROM worktracker_issue LIMIT 1)",
    )
    .await;
    let before = corpus::database_bytes(installation.path());

    let failure = adoption::adopt(installation.path())
        .await
        .expect_err("a defective installation must be refused");

    assert_eq!(failure.refusal(), Refusal::SemanticRefusal);
    assert_eq!(failure.phase(), Phase::Preflight);
    assert!(
        failure.detail().contains("ancestry"),
        "the refusal must name the rule that was broken, got: {}",
        failure.detail()
    );
    corpus::assert_stored_bytes_unchanged(
        installation.path(),
        &before,
        "refusing a defective source",
    );
}

#[tokio::test]
async fn every_historical_generation_bridges_to_one_canonical_leaf_and_reopens_twice() {
    use muxed_studio_lib::installation_adoption::inventory;
    use sea_orm::Database;

    let canonical = corpus::install("django-current");
    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        canonical.path().join("state.db").display()
    ))
    .await
    .expect("open the canonical fixture");
    let canonical_inventory = inventory::read(&database)
        .await
        .expect("inventory the canonical fixture");
    database.close().await.expect("close the canonical fixture");

    for generation in classification::manifest()
        .generations
        .iter()
        .filter(|generation| generation.expected == "bridge")
    {
        let installation = corpus::install(&generation.name);
        let migration_rows = django_migration_provenance(installation.path()).await;

        let bridged = adoption::adopt(installation.path())
            .await
            .unwrap_or_else(|error| panic!("{} must bridge: {error}", generation.name));
        assert_eq!(bridged.path, AdoptionPath::Bridged, "{}", generation.name);
        assert_eq!(
            bridged.counts, canonical_inventory.counts,
            "{}",
            generation.name
        );
        assert_eq!(bridged.bridges.len(), 1, "{}", generation.name);
        let committed = ledger(installation.path()).await;
        assert_eq!(committed.bridges, bridged.bridges, "{}", generation.name);
        assert_eq!(
            committed.preserved_digest, bridged.preserved_digest,
            "{}",
            generation.name
        );
        assert_eq!(
            migration_rows,
            django_migration_provenance(installation.path()).await,
            "{} changed Django provenance",
            generation.name
        );

        for cycle in 1..=2 {
            let reopened = adoption::adopt(installation.path())
                .await
                .unwrap_or_else(|error| {
                    panic!("{} reopen {cycle} failed: {error}", generation.name)
                });
            assert_eq!(reopened.path, AdoptionPath::Reopened);
            assert_eq!(reopened.bridges, bridged.bridges);
            assert_eq!(reopened.preserved_digest, bridged.preserved_digest);
        }
    }
}

#[tokio::test]
async fn an_alembic_source_with_rows_fails_its_recorded_precondition() {
    use muxed_studio_lib::installation_adoption::bridge;
    use sea_orm::{Database, TransactionTrait};

    let installation = corpus::install("alembic-0006_design_documents");
    corpus::execute(
        installation.path(),
        "INSERT INTO app_settings (scope, \"key\", value, updated_at) VALUES ('global', 'theme', 'dark', '2026-08-23')",
    )
    .await;

    let classified = classification::classify(installation.path())
        .await
        .expect("the Alembic source must classify");
    let Installation::SqliteHistorical(generation) = classified else {
        panic!("the source must be historical")
    };
    let selected = bridge::select(&generation.name, &generation.fingerprint)
        .expect("the source must have a bridge");
    let database = Database::connect(format!(
        "sqlite:{}?mode=rw",
        installation.path().join("state.db").display()
    ))
    .await
    .expect("open the source");
    let transaction = database.begin().await.expect("begin the bridge boundary");
    let failure = bridge::apply(&transaction, &[selected])
        .await
        .expect_err("the empty-only Alembic correction must refuse rows");
    assert_eq!(failure.phase(), Phase::BridgeWork);
    assert_eq!(failure.refusal(), Refusal::BridgePreconditionFailed);
    transaction.rollback().await.expect("roll back the refusal");
    database.close().await.expect("close the source");
}

#[tokio::test]
async fn a_historical_bridge_crash_before_commit_leaves_the_source_reusable() {
    let installation = corpus::install("django-current-shipping");

    let failure = adoption::adopt_with(
        installation.path(),
        &AdoptionPlan::failing_after(Phase::BridgeWork),
    )
    .await
    .expect_err("the fault must roll the bridge back");

    assert_eq!(failure.refusal(), Refusal::InjectedFault);
    assert!(matches!(
        classification::classify(installation.path())
            .await
            .expect("the rolled-back source must classify"),
        Installation::SqliteHistorical(_)
    ));
    assert_eq!(
        adoption::adopt(installation.path())
            .await
            .expect("retry must bridge")
            .path,
        AdoptionPath::Bridged
    );
}

#[tokio::test]
async fn an_unreachable_postgresql_source_fails_without_exposing_or_switching_it() {
    let installation = tempfile::tempdir().expect("create a data directory");
    std::fs::write(
        installation.path().join("database-url"),
        "postgresql://ticketry:secret@localhost/ticketry",
    )
    .expect("write the PostgreSQL marker");
    std::fs::write(installation.path().join("database-url.enabled"), "1")
        .expect("enable the PostgreSQL marker");

    let failure = adoption::adopt(installation.path())
        .await
        .expect_err("an unreachable PostgreSQL source must fail preflight");

    assert_eq!(failure.refusal(), Refusal::SemanticRefusal);
    assert!(
        !failure.detail().contains("secret"),
        "a refusal must not carry the source credential"
    );
    assert!(installation.path().join("database-url.enabled").is_file());
    assert!(!installation.path().join("state.db").exists());
}

// ---------------------------------------------------------------------------
// The crash boundaries either side of the ledger commit
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_failure_before_the_ledger_commits_leaves_the_source_reusable() {
    let installation = corpus::install("current-small");

    let failure = adoption::adopt_with(
        installation.path(),
        &AdoptionPlan::failing_after(Phase::HashVerification),
    )
    .await
    .expect_err("the injected fault must stop adoption");

    assert_eq!(failure.refusal(), Refusal::InjectedFault);
    let classified = classification::classify(installation.path())
        .await
        .expect("the source must still classify");
    assert!(
        matches!(classified, Installation::SqliteCurrent(_)),
        "a source that was never committed must still be the generation it was"
    );
    adopt_and_open(installation.path()).await;
}

#[tokio::test]
async fn a_failure_after_the_ledger_commits_reopens_as_rust_owned_and_finishes() {
    let installation = corpus::install("current-small");

    adoption::adopt_with(
        installation.path(),
        &AdoptionPlan::failing_after(Phase::LedgerCommit),
    )
    .await
    .expect_err("the injected fault must stop adoption");

    assert_eq!(
        ledger(installation.path()).await.completion,
        Completion::Committed,
        "an interrupted adoption must be distinguishable from a finished one"
    );
    let classified = classification::classify(installation.path())
        .await
        .expect("an installation with a committed ledger must classify");
    assert!(
        matches!(classified, Installation::RustOwned(_)),
        "a committed adoption must reopen as Rust-owned"
    );

    let finished = adopt_and_open(installation.path()).await;
    assert_eq!(finished.readiness, Readiness::Open);
    assert_eq!(
        ledger(installation.path()).await.completion,
        Completion::Ready
    );
}

#[tokio::test]
async fn a_failed_postflight_keeps_readiness_closed() {
    let installation = corpus::install("current-small");

    let failure = adoption::adopt_with(
        installation.path(),
        &AdoptionPlan::failing_after(Phase::Postflight),
    )
    .await
    .expect_err("the injected fault must stop adoption");

    assert_eq!(failure.phase(), Phase::Postflight);
    assert!(
        !failure.refusal().source_is_untouched(),
        "a failure past the exclusive phase points at the snapshot"
    );
    assert!(failure.recovery().contains("recovery snapshot"));
    assert_eq!(
        ledger(installation.path()).await.completion,
        Completion::Committed,
        "readiness must not be recorded when validation did not finish"
    );
}

// ---------------------------------------------------------------------------
// Recovery points
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_final_python_era_snapshot_is_pinned_outside_rotation() {
    let installation = corpus::install("current-small");
    adopt_and_open(installation.path()).await;

    let pinned = installation
        .path()
        .join(muxed_studio_lib::installation_adoption::snapshot::PINNED_SNAPSHOT);
    assert!(pinned.is_file(), "the cutover snapshot must be pinned");
    let bytes = std::fs::read(&pinned).expect("read the pinned snapshot");

    // Later adoptions must not be able to rotate it out.
    for _ in 0..4 {
        let _ = adoption::adopt(installation.path()).await;
    }
    assert_eq!(
        bytes,
        std::fs::read(&pinned).expect("read the pinned snapshot again"),
        "normal rotation must never replace the last pre-Rust recovery point"
    );
}

#[tokio::test]
async fn the_snapshot_manifest_names_external_roots_without_copying_them() {
    let installation = corpus::install("current-representative");
    let adopted = adopt_and_open(installation.path()).await;
    let snapshot = adopted.snapshot.expect("adoption must create a snapshot");

    let manifest = std::fs::read_to_string(
        installation
            .path()
            .join(format!("{}.manifest.json", snapshot.file)),
    )
    .expect("the snapshot manifest must exist");
    assert!(manifest.contains("\"sourceEngine\": \"sqlite\""));
    assert!(manifest.contains("\"worktrees\""));
    assert!(manifest.contains(&snapshot.sha256));
    assert!(
        !manifest.contains(&installation.path().display().to_string()),
        "a manifest must not carry an absolute path into the user's work"
    );
}

#[tokio::test]
async fn recovery_discovery_lists_both_manifests_and_revalidates_a_selection() {
    let installation = corpus::install("current-representative");
    adopt_and_open(installation.path()).await;

    let discovered =
        adoption::recovery::discover(installation.path()).expect("discover recovery points");
    assert_eq!(
        discovered.len(),
        2,
        "the rotating and pinned copies both need manifests"
    );
    assert!(discovered.iter().all(|point| point.completed));
    assert!(discovered.iter().all(|point| point.snapshot.verified));
    assert!(discovered.iter().all(|point| {
        point
            .external_roots
            .iter()
            .all(|root| !root.name.starts_with('/'))
    }));

    let pinned = discovered
        .iter()
        .find(|point| point.snapshot.pinned)
        .expect("discover the pinned source");
    assert_eq!(pinned.snapshot.generation, 0);
    adoption::recovery::validate_selected(installation.path(), &pinned.snapshot.file)
        .await
        .expect("independently validate the pinned source");
}

#[tokio::test]
async fn recovery_validation_rejects_a_snapshot_changed_after_discovery() {
    use std::io::{Seek, SeekFrom, Write};

    let installation = corpus::install("current-small");
    adopt_and_open(installation.path()).await;
    let selected = adoption::recovery::discover(installation.path())
        .expect("discover recovery points")
        .into_iter()
        .find(|point| !point.snapshot.pinned)
        .expect("discover a rotating recovery point");
    let path = installation.path().join(&selected.snapshot.file);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("open the recovery point for corruption");
    file.seek(SeekFrom::Start(128)).expect("seek into snapshot");
    file.write_all(b"changed").expect("change snapshot bytes");
    file.sync_all().expect("flush changed snapshot");

    let failure =
        adoption::recovery::validate_selected(installation.path(), &selected.snapshot.file)
            .await
            .expect_err("a changed snapshot must fail independent validation");
    assert_eq!(failure.refusal(), Refusal::SnapshotFailed);
    assert!(failure.detail().contains("hash"));
}

#[tokio::test]
async fn a_snapshot_that_does_not_reproduce_the_source_is_refused() {
    use muxed_studio_lib::installation_adoption::{inventory, snapshot};
    use sea_orm::Database;

    let installation = corpus::install("current-representative");
    let source = {
        let database = Database::connect(format!(
            "sqlite:{}?mode=ro",
            installation.path().join("state.db").display()
        ))
        .await
        .expect("open the installation");
        let read = inventory::read(&database)
            .await
            .expect("inventory the installation");
        database.close().await.expect("close the installation");
        read
    };

    // A copy that lost rows on the way to disk is indistinguishable from a good
    // one until it is reopened and compared, which is the point of doing so.
    let damaged = installation.path().join("damaged-snapshot.db");
    std::fs::copy(installation.path().join("state.db"), &damaged).expect("copy the installation");
    corpus::execute(installation.path(), "SELECT 1").await;
    let writer = Database::connect(format!("sqlite:{}?mode=rw", damaged.display()))
        .await
        .expect("open the copy");
    sea_orm::ConnectionTrait::execute_unprepared(&writer, "DELETE FROM design_documents")
        .await
        .expect("lose rows on the way to disk");
    writer.close().await.expect("close the copy");

    let failure = snapshot::verify(&damaged, &source, false)
        .await
        .expect_err("a snapshot that lost rows must be refused");

    assert_eq!(failure.refusal(), Refusal::SnapshotFailed);
    assert!(
        failure.detail().contains("design_documents"),
        "the refusal must name what the copy lost, got: {}",
        failure.detail()
    );
}

#[tokio::test]
async fn every_product_table_holds_the_same_values_after_adoption() {
    use muxed_studio_lib::installation_adoption::inventory;
    use sea_orm::Database;

    async fn preserved(data_directory: &Path) -> inventory::Inventory {
        let database = Database::connect(format!(
            "sqlite:{}?mode=ro",
            data_directory.join("state.db").display()
        ))
        .await
        .expect("open the installation");
        let read = inventory::read(&database)
            .await
            .expect("inventory the installation");
        database.close().await.expect("close the installation");
        read
    }

    let installation = corpus::install("current-representative");
    let before = preserved(installation.path()).await;
    assert!(
        before.counts.len() >= 20,
        "the comparison must cover every product table, saw {}",
        before.counts.len()
    );

    adoption::adopt(installation.path())
        .await
        .expect("a current installation must adopt");

    let after = preserved(installation.path()).await;
    assert_eq!(
        before.differences(&after),
        Vec::<String>::new(),
        "no product table may lose a row or change a stored value"
    );
    assert_eq!(before.combined_digest(), after.combined_digest());
}

#[tokio::test]
async fn an_installation_another_process_holds_the_lease_on_is_refused() {
    let installation = corpus::install("current-small");
    let before = corpus::database_bytes(installation.path());
    // Process 1 is alive on every Unix host, so the conflicting owner in this
    // record is a live process rather than a stale entry adoption may reclaim.
    std::fs::write(
        installation.path().join(".muxed-desktop-owner.json"),
        serde_json::json!({
            "pid": 1,
            "nonce": "another-ticketry",
            "acquired_at_millis": 0,
        })
        .to_string(),
    )
    .expect("record a conflicting owner");

    let failure = adoption::adopt(installation.path())
        .await
        .expect_err("an installation another process leases must be refused");

    assert_eq!(failure.refusal(), Refusal::LeaseUnavailable);
    assert_eq!(failure.phase(), Phase::LeaseAcquisition);
    assert!(failure.refusal().source_is_untouched());
    corpus::assert_stored_bytes_unchanged(
        installation.path(),
        &before,
        "refusing a leased installation",
    );
}
