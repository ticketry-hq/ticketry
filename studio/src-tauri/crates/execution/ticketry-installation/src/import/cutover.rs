//! The one installation activation switch.

use std::fs::{self, File};
use std::path::{Path, PathBuf};

use super::{failed, StagedImport};
use crate::adoption::{AdoptionFailure, Phase, Refusal};

const ACTIVE_DATABASE: &str = "state.db";
const POSTGRES_GATE: &str = "database-url.enabled";
const ROLLBACK_GATE: &str = "database-url.postgresql-rollback";

/// Place the validated target, then atomically disable PostgreSQL.
///
/// Until the final marker rename succeeds, the old PostgreSQL installation is
/// still active. The SQLite file may already be in its final location, but it
/// remains non-ready and no runtime selects it.
pub fn activate(data_directory: &Path, staged: StagedImport) -> Result<(), AdoptionFailure> {
    let (staged_directory, _, _) = staged.into_parts();
    let staged_database = staged_directory.join(ACTIVE_DATABASE);
    let active_database = data_directory.join(ACTIVE_DATABASE);
    if active_database.exists() {
        let dormant = next_dormant_path(data_directory);
        fs::rename(&active_database, &dormant).map_err(|error| {
            activation_failed(format!(
                "the dormant SQLite database could not be preserved before import: {error}"
            ))
        })?;
    }
    fs::rename(&staged_database, &active_database).map_err(|error| {
        activation_failed(format!(
            "the validated SQLite target could not be placed: {error}"
        ))
    })?;
    sync_directory(data_directory)?;

    // This rename is the only change that selects another engine. The DSN
    // marker itself is deliberately retained for rollback and support.
    fs::rename(
        data_directory.join(POSTGRES_GATE),
        data_directory.join(ROLLBACK_GATE),
    )
    .map_err(|error| {
        activation_failed(format!(
            "the atomic installation switch could not be committed: {error}"
        ))
    })?;
    sync_directory(data_directory)?;
    let _ = fs::remove_dir(staged_directory);
    Ok(())
}

fn next_dormant_path(data_directory: &Path) -> PathBuf {
    let base = data_directory.join("state.db.before-postgresql-import");
    if !base.exists() {
        return base;
    }
    (1..)
        .map(|index| data_directory.join(format!("state.db.before-postgresql-import.{index}")))
        .find(|path| !path.exists())
        .expect("the filesystem cannot contain every numbered dormant database")
}

fn sync_directory(directory: &Path) -> Result<(), AdoptionFailure> {
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            activation_failed(format!(
                "the installation directory could not be synced: {error}"
            ))
        })
}

fn activation_failed(detail: String) -> AdoptionFailure {
    failed(Phase::Postflight, Refusal::PostflightFailed, detail)
}

#[cfg(test)]
mod tests {
    use super::{activate, ACTIVE_DATABASE, POSTGRES_GATE, ROLLBACK_GATE};
    use crate::import::StagedImport;

    #[test]
    fn activation_preserves_postgres_and_switches_only_after_target_placement() {
        let data = tempfile::tempdir().expect("create installation");
        let staged = tempfile::tempdir_in(data.path()).expect("create staged target");
        std::fs::write(data.path().join("database-url"), "postgresql:///ticketry")
            .expect("write retained DSN");
        std::fs::write(data.path().join(POSTGRES_GATE), "enabled").expect("enable source");
        std::fs::write(data.path().join(ACTIVE_DATABASE), "dormant").expect("write dormant SQLite");
        std::fs::write(staged.path().join(ACTIVE_DATABASE), "canonical").expect("write target");
        let staged_path = staged.keep();

        activate(
            data.path(),
            StagedImport {
                directory: staged_path,
                generation: "django-current".into(),
                bridges: Vec::new(),
            },
        )
        .expect("activate target");

        assert_eq!(
            std::fs::read(data.path().join(ACTIVE_DATABASE)).unwrap(),
            b"canonical"
        );
        assert_eq!(
            std::fs::read(data.path().join("state.db.before-postgresql-import")).unwrap(),
            b"dormant"
        );
        assert_eq!(
            std::fs::read_to_string(data.path().join("database-url")).unwrap(),
            "postgresql:///ticketry"
        );
        assert!(!data.path().join(POSTGRES_GATE).exists());
        assert!(data.path().join(ROLLBACK_GATE).exists());
    }

    #[test]
    fn failed_marker_switch_leaves_postgres_active_and_target_non_ready() {
        let data = tempfile::tempdir().expect("create installation");
        let staged = tempfile::tempdir_in(data.path()).expect("create staged target");
        std::fs::write(data.path().join("database-url"), "postgresql:///ticketry")
            .expect("write retained DSN");
        std::fs::write(data.path().join(POSTGRES_GATE), "enabled").expect("enable source");
        std::fs::create_dir(data.path().join(ROLLBACK_GATE)).expect("block marker rename");
        std::fs::write(data.path().join(ROLLBACK_GATE).join("keep"), "occupied")
            .expect("make destination non-empty");
        std::fs::write(staged.path().join(ACTIVE_DATABASE), "non-ready").expect("write target");
        let staged_path = staged.keep();

        let failure = activate(
            data.path(),
            StagedImport {
                directory: staged_path,
                generation: "django-current".into(),
                bridges: Vec::new(),
            },
        )
        .expect_err("refuse failed switch");

        assert_eq!(failure.phase(), crate::adoption::Phase::Postflight);
        assert!(data.path().join(POSTGRES_GATE).is_file());
        assert_eq!(
            std::fs::read(data.path().join(ACTIVE_DATABASE)).unwrap(),
            b"non-ready"
        );
        assert_eq!(
            std::fs::read_to_string(data.path().join("database-url")).unwrap(),
            "postgresql:///ticketry"
        );
    }
}
