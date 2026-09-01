//! Taking ownership of the installation the user already has.
//!
//! Every other slice assumes it is running against a data directory Rust owns.
//! This crate is what makes that true, exactly once, on the way in.
//!
//! [`classification`] reads the data directory and returns one checked answer
//! about which installation it found — a current or recorded SQLite
//! generation, a PostgreSQL import source, an installation Rust already owns,
//! or nothing at all — refusing anything it cannot name. [`preflight`] then
//! asks the separate question of whether the contents can be carried forward,
//! reading through a single transaction so its report describes one committed
//! state. [`import`] copies a supported PostgreSQL source into canonical
//! SQLite. [`adoption`] performs the one irreversible step: it takes the
//! installation exclusively, snapshots it, records in one transaction that
//! Rust owns it, provisions the Rust-only journals the source never had, and
//! only then opens readiness. [`final_schema_migrations`] composes the 0044
//! through 0052 parity chain, which spans work management, settings and
//! worktree schemas and so belongs to none of them.

mod adoption;
mod classification;
mod final_schema_migrations;
mod import;
mod preflight;

// This is the installation crate's complete external contract. The
// implementation tree stays private so callers cannot couple themselves to
// adoption phases, classifier engines, or preflight rule modules. The few
// lower-level exports below are deliberate inspection seams used by migration
// and recovery tooling; they are grouped here so they remain visible in one
// reviewable facade rather than becoming accidental nested APIs.
pub use adoption::bridge::{
    apply as apply_bridge, catalog as bridge_catalog, select as select_bridge, Bridge, Catalog,
};
pub use adoption::error::{AdoptionFailure, Refusal};
pub use adoption::inventory::{read as read_inventory, Inventory as AdoptionInventory};
pub use adoption::ledger::{
    read as read_adoption_ledger, Completion, LedgerRow, LEDGER_TABLE, RUST_LEAF,
};
pub use adoption::outcome::{Adoption, AdoptionPath, EventBoundary, Readiness, EVIDENCE_FILE};
pub use adoption::phase::{AdoptionPlan, Phase};
pub use adoption::provisioning::provision;
pub use adoption::recovery::{
    discover as discover_recovery, validate_selected as validate_recovery,
};
pub use adoption::snapshot::{verify as verify_snapshot, SnapshotRecord, PINNED_SNAPSHOT};
pub use adoption::snapshot_manifest::{ExternalRoot, SnapshotManifest};
pub use adoption::{adopt, adopt_with};
pub use adoption::ownership::{open_readiness, open_readiness_with};
pub use classification::manifest::{manifest, CorpusFixture, Generation, Manifest, MigrationStep};
pub use classification::classify;
pub use classification::outcome::{
    ClassificationError, Engine, Installation, PostgresSource, Refusal as ClassificationRefusal,
    RustOwnership, SqliteGeneration,
};
pub use classification::rust_ledger::owned_ledgers;
pub use final_schema_migrations::{
    install as install_final_schema_migrations, ORDERED_MIGRATION_IDS,
};
pub use import::cutover::activate as activate_import;
pub use import::{stage as stage_import, StagedImport};
pub use preflight::error::{PreflightError, PreflightFailure};
pub use preflight::preflight;
pub use preflight::report::{Area, Defect, PreflightReport, Skipped, Verdict};
