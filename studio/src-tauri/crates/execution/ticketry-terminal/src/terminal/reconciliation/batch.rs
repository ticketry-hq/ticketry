//! Bounded, fair selection of the recorded terminal rows one reconciliation
//! pass inspects. Rows whose durable state can still change are scanned before
//! settled tombstones, and each tier keeps a cursor so the next pass resumes
//! where this pass stopped instead of re-reading the oldest rows forever.

use std::sync::Mutex;

use sea_orm::{
    sea_query::Condition, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect,
};

use ticketry_entities::session;

use super::TerminalReconciliationError;

/// The largest number of recorded Terminal Sessions one pass inspects.
pub const MAX_RECORDED_SESSION_BATCH: u64 = 200;

/// The (age, identity) position a tier resumes from on the next pass.
#[derive(Clone, Debug, Eq, PartialEq)]
struct RecordedSessionCursor {
    created_at: String,
    agent_run_id: String,
}

impl RecordedSessionCursor {
    fn of(row: &session::Model) -> Self {
        Self {
            created_at: row.created_at.clone(),
            agent_run_id: row.agent_run_id.clone(),
        }
    }

    /// Keyset advancement over the scan order, so a resumed scan cannot repeat
    /// or skip a row when rows are inserted or removed between passes.
    fn after(&self) -> Condition {
        Condition::any()
            .add(session::Column::CreatedAt.gt(self.created_at.clone()))
            .add(
                Condition::all()
                    .add(session::Column::CreatedAt.eq(self.created_at.clone()))
                    .add(session::Column::AgentRunId.gt(self.agent_run_id.clone())),
            )
    }
}

/// Where each tier's next pass resumes. Every clone of the reconciliation
/// service shares one instance, so startup, the periodic sweep, and effect
/// wake-ups all advance the same scan.
#[derive(Debug, Default)]
pub(super) struct RecordedSessionCursors {
    changeable: Mutex<Option<RecordedSessionCursor>>,
    settled: Mutex<Option<RecordedSessionCursor>>,
}

pub(super) struct RecordedSessionBatch {
    pub rows: Vec<session::Model>,
    /// A row eligible for this pass was left uninspected; a later pass takes it.
    pub saturated: bool,
}

/// Rows whose durable state can still change: live sessions and tombstones
/// still owing runtime cleanup. These are scanned first so a long history can
/// never starve an active session.
fn changeable_tier() -> Condition {
    Condition::any()
        .add(session::Column::TerminatedAt.is_null())
        .add(session::Column::RuntimeCleanupPending.eq(true))
}

/// Settled tombstones. They are still inspected — a tombstone whose runtime is
/// running has to be recovered — but only after changeable rows, and only a
/// cursor-advanced window per pass.
fn settled_tier() -> Condition {
    Condition::all()
        .add(session::Column::TerminatedAt.is_not_null())
        .add(session::Column::RuntimeCleanupPending.eq(false))
}

/// The two tiers partition the recorded rows, so every row stays reachable.
pub(super) async fn recorded_session_batch(
    database: &DatabaseConnection,
    cursors: &RecordedSessionCursors,
) -> Result<RecordedSessionBatch, TerminalReconciliationError> {
    let changeable = scan_tier(
        database,
        changeable_tier(),
        &cursors.changeable,
        MAX_RECORDED_SESSION_BATCH,
    )
    .await?;
    let remaining = MAX_RECORDED_SESSION_BATCH - changeable.rows.len() as u64;
    let settled = scan_tier(database, settled_tier(), &cursors.settled, remaining).await?;
    let mut rows = changeable.rows;
    rows.extend(settled.rows);
    Ok(RecordedSessionBatch {
        rows,
        saturated: changeable.more || settled.more,
    })
}

struct TierScan {
    rows: Vec<session::Model>,
    more: bool,
}

/// Take up to `capacity` rows from where this tier stopped. A tier that reaches
/// its end restarts from its oldest row, so scanning cycles instead of stalling.
/// A capacity of zero only reports whether the tier still owes work.
async fn scan_tier(
    database: &DatabaseConnection,
    tier: Condition,
    cursor: &Mutex<Option<RecordedSessionCursor>>,
    capacity: u64,
) -> Result<TierScan, TerminalReconciliationError> {
    let resume = cursor.lock().expect("reconciliation cursor").clone();
    let mut scan = read_tier(database, tier.clone(), resume.as_ref(), capacity).await?;
    if capacity == 0 {
        return Ok(scan);
    }
    if scan.rows.is_empty() && resume.is_some() {
        scan = read_tier(database, tier, None, capacity).await?;
    }
    *cursor.lock().expect("reconciliation cursor") = scan
        .more
        .then(|| scan.rows.last().map(RecordedSessionCursor::of))
        .flatten();
    Ok(scan)
}

async fn read_tier(
    database: &DatabaseConnection,
    tier: Condition,
    resume: Option<&RecordedSessionCursor>,
    capacity: u64,
) -> Result<TierScan, TerminalReconciliationError> {
    let mut condition = Condition::all().add(tier);
    if let Some(resume) = resume {
        condition = condition.add(resume.after());
    }
    let mut rows = session::Entity::find()
        .filter(condition)
        .order_by_asc(session::Column::CreatedAt)
        .order_by_asc(session::Column::AgentRunId)
        .limit(capacity + 1)
        .all(database)
        .await?;
    let more = rows.len() as u64 > capacity;
    rows.truncate(capacity as usize);
    Ok(TierScan { rows, more })
}
