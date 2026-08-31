//! When compaction actually runs in a shipping build.
//!
//! Compaction is startup work first. A pass runs after reconciliation and
//! before the readiness gate opens, while no subscriber is streaming: the
//! watermark a resuming client then reads is already the one this launch will
//! honour, so a client is never told mid-stream that the history behind it
//! disappeared.
//!
//! A pass at startup alone is not enough. An installation that stays open for
//! weeks would accumulate an unbounded outbox between launches, so the same
//! pass repeats on an interval for as long as the process lives.
//!
//! Both drivers are the same bounded work: [`StatusCompactionService`] walks
//! one project at a time and deletes in batches, so a pass never holds one
//! long transaction open against live writers.

use std::time::Duration;

use sea_orm::DatabaseConnection;

use super::status_compaction::{CompactionOutcome, CompactionPolicy};
use super::{RunsPersistenceError, RunsServices};

/// How long a running installation waits between passes. Retention is measured
/// in days and in a hundred thousand events, so a pass a few times a day keeps
/// the outbox bounded without ever competing with live status writers.
pub const COMPACTION_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// The production schedule for outbox compaction: one pass now, and the same
/// pass again on an interval.
#[derive(Clone)]
pub struct CompactionSchedule {
    database: DatabaseConnection,
    policy: CompactionPolicy,
    interval: Duration,
}

impl CompactionSchedule {
    /// The schedule a desktop launch installs: the shipped retention policy on
    /// the shipped interval.
    pub fn new(database: DatabaseConnection) -> Self {
        Self {
            database,
            policy: CompactionPolicy::default(),
            interval: COMPACTION_INTERVAL,
        }
    }

    /// Narrow the retention window. Tests use this so a backlog can be
    /// compacted without fabricating a month of history.
    pub fn with_policy(self, policy: CompactionPolicy) -> Self {
        Self { policy, ..self }
    }

    /// Shorten the wait between passes. Tests use this so the periodic driver
    /// can be observed without waiting hours for its second pass.
    pub fn with_interval(self, interval: Duration) -> Self {
        Self { interval, ..self }
    }

    /// One incremental pass over every project that still holds history. This
    /// is the call a startup makes before it opens the readiness gate.
    pub async fn pass(&self) -> Result<Vec<CompactionOutcome>, RunsPersistenceError> {
        RunsServices::new(self.database.clone())
            .compaction()
            .clone()
            .with_policy(self.policy)
            .compact_all()
            .await
    }

    /// Repeat the pass for the life of the process. The first sleep comes
    /// before the first pass because the caller has just run one at startup.
    ///
    /// A failed pass is reported and the schedule continues: compaction is
    /// housekeeping, and a store that could not be pruned this time still
    /// serves status correctly and will be offered the next pass.
    pub async fn drive(self) {
        loop {
            tokio::time::sleep(self.interval).await;
            if let Err(error) = self.pass().await {
                eprintln!("Ticketry could not compact the Runs status outbox: {error}");
            }
        }
    }
}
