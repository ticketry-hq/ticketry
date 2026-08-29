//! Move every committed write-ahead-log frame into the database file.
//!
//! A recovery snapshot is a copy of one file. An installation in
//! write-ahead-log mode keeps its most recent committed rows in a second file,
//! so copying the database alone silently drops whatever was committed since
//! the last checkpoint — the newest work, which is the work a user would most
//! notice losing. The corpus carries a fixture whose whole latest generation
//! lives in the log for exactly this reason.
//!
//! `TRUNCATE` is the required mode. It refuses unless every frame is applied
//! *and* the log is reset to empty, so a successful result is the proof that
//! the database file alone now holds all committed content.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::error::{AdoptionFailure, Refusal};
use super::phase::Phase;

/// Checkpoint the log and verify it completed, or refuse adoption.
///
/// The three result columns are read from one row. Re-running the pragma to
/// read each column would checkpoint again, and a second attempt that happened
/// to succeed would erase the evidence that the first one found a busy
/// installation.
pub async fn checkpoint(database: &DatabaseConnection) -> Result<(), AdoptionFailure> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA wal_checkpoint(TRUNCATE)".to_owned(),
        ))
        .await
        .map_err(|error| failed(error.to_string()))?
        .ok_or_else(|| failed("the checkpoint returned no result".to_owned()))?;
    let column = |index: usize| {
        row.try_get_by_index::<i64>(index)
            .map_err(|error| failed(error.to_string()))
    };
    let busy = column(0)?;
    let log_frames = column(1)?;
    let checkpointed = column(2)?;
    if busy != 0 {
        return Err(AdoptionFailure::new(
            Phase::WalCheckpoint,
            Refusal::InstallationBusy,
            "the write-ahead log could not be checkpointed because another connection is \
             attached to the installation",
        ));
    }
    if log_frames != checkpointed {
        return Err(AdoptionFailure::new(
            Phase::WalCheckpoint,
            Refusal::CheckpointFailed,
            format!(
                "the write-ahead log still holds frames after a truncating checkpoint \
                 ({log_frames} present, {checkpointed} applied)"
            ),
        ));
    }
    Ok(())
}

fn failed(detail: String) -> AdoptionFailure {
    AdoptionFailure::new(
        Phase::WalCheckpoint,
        Refusal::CheckpointFailed,
        format!("the write-ahead log could not be checkpointed: {detail}"),
    )
}
