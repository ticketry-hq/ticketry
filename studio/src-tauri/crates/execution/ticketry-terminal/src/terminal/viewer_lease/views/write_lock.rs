//! Take SQLite's write lock before a restricted Viewer Lease view reads.
//!
//! seaolim's `register_restricted_model_mutation` opens every view transaction
//! with a deferred `BEGIN` (rev 29f2417). On the WAL command pool a deferred
//! transaction that reads first and writes later fails with SQLITE_BUSY (5) or
//! SQLITE_BUSY_SNAPSHOT (517) "database is locked" when another connection
//! commits in between, and SQLite does not run the busy handler for that
//! upgrade (CODING-1555, CODING-1564). Until seaolim opens the transaction with
//! `BEGIN IMMEDIATE`, the views reserve the write lock themselves: a write
//! statement that touches no row still starts the write transaction, and at
//! that point the busy handler queues behind the concurrent writer.

use sea_orm::{ConnectionTrait, DatabaseTransaction};
use seaography::async_graphql::Result;

const RESERVE_WRITE_LOCK: &str =
    "UPDATE agent_run_viewer_leases SET agent_run_id = agent_run_id WHERE 0";

/// Promote the deferred view transaction to a write transaction before its
/// first read so a concurrent committer cannot invalidate the snapshot.
pub(super) async fn reserve(transaction: &DatabaseTransaction) -> Result<()> {
    transaction.execute_unprepared(RESERVE_WRITE_LOCK).await?;
    Ok(())
}
