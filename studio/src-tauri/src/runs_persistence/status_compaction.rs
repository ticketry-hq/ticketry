//! Project-aware compaction of the durable status outbox.
//!
//! Two orderings are the whole point of this module.
//!
//! **Retention is the intersection of two protections.** A row may be deleted
//! only when it is both older than the retention window *and* outside the
//! newest retained rows for its own project. A quiet project therefore keeps
//! its short history indefinitely, and a busy one keeps a full recent window
//! even when every row in it is young.
//!
//! **The watermark advances durably before anything is deleted.** A crash
//! between the two leaves rows that are already declared compacted: a resuming
//! client is reset and refetches its canonical holdings, which is correct but
//! wasteful. The reverse order would delete history the watermark still claims
//! is replayable, and a client would resume across a silent gap. One is a cost;
//! the other is data loss.
//!
//! Deletion itself is incremental. A backlog is removed in bounded batches so
//! compaction never holds one long transaction open against live writers.

use chrono::{Duration, Utc};
use sea_orm::{DatabaseConnection, TransactionTrait};

use super::{CompactionWatermarkRepository, RunsPersistenceError, StatusEventRepository};

/// Retained history: at least this many days, and at least this many of a
/// project's newest events, whichever protects more.
pub const RETENTION_DAYS: i64 = 30;
pub const RETAINED_EVENTS: u64 = 100_000;
/// Rows removed per delete statement. Bounded so a first compaction of a large
/// backlog stays incremental.
pub const COMPACTION_BATCH: u64 = 512;

#[derive(Clone, Copy, Debug)]
pub struct CompactionPolicy {
    pub retention_days: i64,
    pub retained_events: u64,
    pub batch: u64,
}

impl Default for CompactionPolicy {
    fn default() -> Self {
        Self {
            retention_days: RETENTION_DAYS,
            retained_events: RETAINED_EVENTS,
            batch: COMPACTION_BATCH,
        }
    }
}

/// What one project's compaction pass actually did. `compacted_through` is the
/// durable watermark after the pass, whether or not this pass advanced it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactionOutcome {
    pub project_id: String,
    pub compacted_through: i64,
    pub deleted: u64,
}

/// Compaction reads and prunes the outbox and owns the watermark. It holds no
/// command service, so it can retire history but never publish it.
#[derive(Clone)]
pub struct StatusCompactionService {
    database: DatabaseConnection,
    events: StatusEventRepository,
    watermarks: CompactionWatermarkRepository,
    policy: CompactionPolicy,
}

impl StatusCompactionService {
    pub(crate) fn new(
        database: DatabaseConnection,
        events: StatusEventRepository,
        watermarks: CompactionWatermarkRepository,
    ) -> Self {
        Self {
            database,
            events,
            watermarks,
            policy: CompactionPolicy::default(),
        }
    }

    /// Narrow the retention window. Tests use this so a realistic backlog can
    /// be compacted without fabricating a month of history.
    pub fn with_policy(self, policy: CompactionPolicy) -> Self {
        Self { policy, ..self }
    }

    pub fn policy(&self) -> CompactionPolicy {
        self.policy
    }

    /// Compact every project that still holds history, one project at a time so
    /// a large project cannot starve a small one of its pass.
    pub async fn compact_all(&self) -> Result<Vec<CompactionOutcome>, RunsPersistenceError> {
        let mut outcomes = Vec::new();
        for project_id in self.events.projects_with_events().await? {
            outcomes.push(self.compact_project(&project_id).await?);
        }
        Ok(outcomes)
    }

    pub async fn compact_project(
        &self,
        project_id: &str,
    ) -> Result<CompactionOutcome, RunsPersistenceError> {
        let retained = self.watermarks.get(project_id).await?;
        let Some(floor) = self.deletable_floor(project_id).await? else {
            // Both protections still cover every row. Rows below an earlier
            // watermark are still swept, because a crash may have left them.
            let deleted = self.delete_incrementally(project_id, retained).await?;
            return Ok(CompactionOutcome {
                project_id: project_id.to_owned(),
                compacted_through: retained,
                deleted,
            });
        };
        let through = floor.max(retained);
        if through > retained {
            // Durable first: the watermark commits in its own transaction, so
            // the deletion below can only ever remove rows a reader is already
            // told to reset over.
            let transaction = self.database.begin().await?;
            self.watermarks
                .advance(&transaction, project_id, through)
                .await?;
            transaction.commit().await?;
        }
        let deleted = self.delete_incrementally(project_id, through).await?;
        Ok(CompactionOutcome {
            project_id: project_id.to_owned(),
            compacted_through: through,
            deleted,
        })
    }

    /// The newest cursor both protections allow to be deleted, or `None` when
    /// either protection still covers the project's whole history.
    async fn deletable_floor(&self, project_id: &str) -> Result<Option<i64>, RunsPersistenceError> {
        let Some(by_count) = self
            .events
            .count_retention_floor(project_id, self.policy.retained_events)
            .await?
        else {
            return Ok(None);
        };
        let before = super::timestamp::database_format(
            Utc::now() - Duration::days(self.policy.retention_days),
        );
        let Some(by_age) = self.events.age_retention_floor(project_id, &before).await? else {
            return Ok(None);
        };
        Ok(Some(by_count.min(by_age)))
    }

    async fn delete_incrementally(
        &self,
        project_id: &str,
        through: i64,
    ) -> Result<u64, RunsPersistenceError> {
        if through <= 0 {
            return Ok(0);
        }
        let mut deleted = 0;
        loop {
            let removed = self
                .events
                .delete_through(project_id, through, self.policy.batch)
                .await?;
            deleted += removed;
            if removed < self.policy.batch {
                return Ok(deleted);
            }
        }
    }
}
