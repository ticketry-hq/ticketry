//! The race-free connection sequence for one project status subscription.
//!
//! The order is fixed and is the whole point of this module: register the
//! wake-up listener, capture the outbox high-water cursor, read the
//! authoritative snapshot, emit the snapshot, replay the retained cursor
//! through the high-water mark in cursor order, emit caught-up, then drain
//! everything above the high-water mark. Listener registration precedes every
//! read, so a commit at any handshake boundary is either replayed or drained —
//! never lost, never reordered.

use std::collections::VecDeque;
use std::time::Duration;

use chrono::Utc;
use futures_util::{stream, stream::BoxStream, StreamExt};

use super::status_frames::{
    failure_code, reset_reason, RunStatusCaughtUp, RunStatusEvent, RunStatusFailed, RunStatusFrame,
    RunStatusResetRequired, RunStatusSnapshot, SUPPORTED_PAYLOAD_VERSION,
};
use super::status_wakeup::{StatusWakeupListener, Wakeup};
use super::{timestamp, StatusEventRecord, StatusStreamService};

/// A severely lagged client is reset rather than served a partial history, so
/// one handshake can never monopolize the database or the transport.
pub const MAX_REPLAY_EVENTS: usize = 2_000;
pub const MAX_REPLAY_BYTES: usize = 4 * 1024 * 1024;
/// Live drains are paged so a slow subscriber retains bounded memory.
const LIVE_PAGE_EVENTS: u64 = 256;
/// A wake-up is only a hint. This bound is what makes a lost hint a delay
/// rather than a lost fact.
const REREAD_INTERVAL: Duration = Duration::from_millis(1_000);

pub struct StatusStreamRequest {
    pub project_id: String,
    pub after_cursor: Option<i64>,
}

/// Build the frame stream. Argument validation is resolved here so a bad
/// request becomes one terminal frame instead of an open subscription.
pub fn open(
    service: StatusStreamService,
    request: StatusStreamRequest,
) -> BoxStream<'static, RunStatusFrame> {
    let mut state = StreamState {
        listener: None,
        public_project_id: String::new(),
        database_project_id: String::new(),
        after_cursor: request.after_cursor,
        last_emitted: 0,
        pending: VecDeque::new(),
        next_read_path: DeliveryPath::PostHandshake,
        phase: Phase::Handshake,
        service,
    };
    match uuid::Uuid::parse_str(&request.project_id) {
        Ok(project_id) if request.after_cursor.is_none_or(|cursor| cursor >= 0) => {
            state.public_project_id = project_id.hyphenated().to_string();
            state.database_project_id = project_id.simple().to_string();
            // Registered before any read. Everything committed from this point
            // on is guaranteed to reach the drain phase.
            state.listener = Some(state.service.wakeup().listen());
            state
                .trace("wake-up-listener-registered", None, None)
                .with_detail(
                    "wakeupAuthority",
                    serde_json::json!(state.service.wakeup().authority_instance()),
                )
                .record();
        }
        Ok(_) => state.fail(
            failure_code::BAD_REQUEST,
            "A retained status cursor cannot be negative.",
        ),
        Err(_) => state.fail(
            failure_code::BAD_REQUEST,
            "The status subscription requires a project identity.",
        ),
    }
    stream::unfold(state, |mut state| async move {
        loop {
            if let Some(frame) = state.pending.pop_front() {
                return Some((frame, state));
            }
            match state.phase {
                Phase::Finished => return None,
                Phase::Handshake => state.handshake().await,
                Phase::Live => state.live().await,
            }
        }
    })
    .boxed()
}

/// One terminal frame for a caller the Runs service cannot serve at all.
pub fn unavailable() -> BoxStream<'static, RunStatusFrame> {
    stream::once(async {
        RunStatusFrame::RunStatusFailed(super::status_frames::RunStatusFailed {
            code: failure_code::UNAVAILABLE.to_owned(),
            message: "The Runs status stream is unavailable.".to_owned(),
        })
    })
    .boxed()
}

enum Phase {
    Handshake,
    Live,
    Finished,
}

struct StreamState {
    service: StatusStreamService,
    public_project_id: String,
    database_project_id: String,
    listener: Option<StatusWakeupListener>,
    after_cursor: Option<i64>,
    last_emitted: i64,
    pending: VecDeque<RunStatusFrame>,
    next_read_path: DeliveryPath,
    phase: Phase,
}

#[derive(Clone, Copy)]
enum DeliveryPath {
    PostHandshake,
    WakeUp,
    SafetyReread,
    DurableBacklog,
}

impl DeliveryPath {
    fn as_str(self) -> &'static str {
        match self {
            Self::PostHandshake => "post_handshake",
            Self::WakeUp => "wake_up",
            Self::SafetyReread => "safety_reread",
            Self::DurableBacklog => "durable_backlog",
        }
    }
}

trait RecordTrace {
    fn record(self);
}

impl RecordTrace for ticketry_diagnostics::LaunchDiscoveryRecord {
    fn record(self) {
        ticketry_diagnostics::record_launch_discovery(self);
    }
}

impl StreamState {
    fn trace(
        &self,
        event: &str,
        agent_run_id: Option<&str>,
        cursor: Option<i64>,
    ) -> ticketry_diagnostics::LaunchDiscoveryRecord {
        ticketry_diagnostics::LaunchDiscoveryRecord::new(
            event,
            ticketry_diagnostics::runtime_instance(),
            (!self.public_project_id.is_empty()).then_some(self.public_project_id.as_str()),
            agent_run_id,
            cursor,
            None,
            None,
        )
    }

    fn fail(&mut self, code: &str, message: &str) {
        self.pending
            .push_back(RunStatusFrame::RunStatusFailed(RunStatusFailed {
                code: code.to_owned(),
                message: message.to_owned(),
            }));
        self.phase = Phase::Finished;
    }

    async fn handshake(&mut self) {
        // The high-water cursor is captured before the snapshot reads. A fact
        // that commits between the two is therefore reflected in the snapshot
        // *and* redelivered above the high-water mark; the reverse order would
        // silently skip it.
        let high_water = match self.service.events().high_water().await {
            Ok(cursor) => cursor,
            Err(_) => return self.fail(failure_code::STORAGE, STORAGE_MESSAGE),
        };
        let at = timestamp::format(Utc::now());
        let runs = match self
            .service
            .queries()
            .run_holdings_at(&self.public_project_id, None, &at)
            .await
        {
            Ok(runs) => runs,
            Err(_) => return self.fail(failure_code::STORAGE, STORAGE_MESSAGE),
        };
        let automation_attempts = match self
            .service
            .attempts()
            .latest(&self.public_project_id, None)
            .await
        {
            Ok(attempts) => attempts,
            Err(_) => return self.fail(failure_code::STORAGE, STORAGE_MESSAGE),
        };
        self.pending
            .push_back(RunStatusFrame::RunStatusSnapshot(RunStatusSnapshot {
                project_id: self.public_project_id.clone(),
                cursor: high_water,
                at,
                runs,
                automation_attempts,
            }));

        if let Some(after_cursor) = self.after_cursor {
            match self.replay(after_cursor, high_water).await {
                Replay::Failed => return,
                Replay::Reset(reason) => {
                    self.pending
                        .push_back(RunStatusFrame::RunStatusResetRequired(
                            RunStatusResetRequired {
                                project_id: self.public_project_id.clone(),
                                cursor: high_water,
                                reason: reason.to_owned(),
                            },
                        ))
                }
                Replay::Delivered => {}
            }
        }

        self.last_emitted = high_water;
        self.pending
            .push_back(RunStatusFrame::RunStatusCaughtUp(RunStatusCaughtUp {
                project_id: self.public_project_id.clone(),
                cursor: high_water,
            }));
        self.trace("subscription-caught-up", None, Some(high_water))
            .with_detail(
                "wakeupAuthority",
                serde_json::json!(self.service.wakeup().authority_instance()),
            )
            .record();
        self.phase = Phase::Live;
    }

    async fn replay(&mut self, after_cursor: i64, high_water: i64) -> Replay {
        if after_cursor > high_water {
            return Replay::Reset(reset_reason::AHEAD_OF_SERVER);
        }
        let watermark = match self
            .service
            .watermarks()
            .get(&self.database_project_id)
            .await
        {
            Ok(watermark) => watermark,
            Err(_) => {
                self.fail(failure_code::STORAGE, STORAGE_MESSAGE);
                return Replay::Failed;
            }
        };
        if watermark > 0 && after_cursor <= watermark {
            return Replay::Reset(reset_reason::COMPACTED);
        }
        // One extra row distinguishes "exactly at the bound" from "over it"
        // without a second count query.
        let rows = match self
            .service
            .events()
            .replay(
                &self.database_project_id,
                after_cursor,
                high_water,
                MAX_REPLAY_EVENTS as u64 + 1,
            )
            .await
        {
            Ok(rows) => rows,
            Err(_) => {
                self.fail(failure_code::STORAGE, STORAGE_MESSAGE);
                return Replay::Failed;
            }
        };
        if rows.len() > MAX_REPLAY_EVENTS
            || rows.iter().map(|row| row.payload.len()).sum::<usize>() > MAX_REPLAY_BYTES
        {
            return Replay::Reset(reset_reason::REPLAY_BOUNDED);
        }
        // Compatibility is decided over the whole span before a single frame is
        // published. Discovering an unreadable row halfway through would leave
        // the client holding a partial history it believes is complete.
        if rows
            .iter()
            .any(|row| row.payload_version > SUPPORTED_PAYLOAD_VERSION)
        {
            return Replay::Reset(reset_reason::EVENT_VERSION_INCOMPATIBLE);
        }
        if self.push_events(rows).is_err() {
            return Replay::Failed;
        }
        Replay::Delivered
    }

    async fn live(&mut self) {
        let delivery_path = self.next_read_path;
        let rows = match self
            .service
            .events()
            .replay(
                &self.database_project_id,
                self.last_emitted,
                i64::MAX,
                LIVE_PAGE_EVENTS,
            )
            .await
        {
            Ok(rows) => rows,
            Err(_) => return self.fail(failure_code::STORAGE, STORAGE_MESSAGE),
        };
        for row in &rows {
            self.trace(
                "durable-event-reread",
                row.agent_run_id.as_deref(),
                Some(row.cursor),
            )
            .with_detail("deliveryPath", serde_json::json!(delivery_path.as_str()))
            .with_detail("committedAt", serde_json::json!(row.committed_at))
            .with_detail(
                "wakeupAuthority",
                serde_json::json!(self.service.wakeup().authority_instance()),
            )
            .record();
        }
        if let Some(cursor) = rows.last().map(|row| row.cursor) {
            if self.push_events(rows).is_ok() {
                self.last_emitted = cursor;
            }
            // A full page means more rows are already durable, so the next
            // turn reads again instead of waiting for another wake-up.
            self.next_read_path = DeliveryPath::DurableBacklog;
            return;
        }
        self.next_read_path = self.wait_for_commit().await;
    }

    async fn wait_for_commit(&mut self) -> DeliveryPath {
        let Some(listener) = self.listener.as_mut() else {
            tokio::time::sleep(REREAD_INTERVAL).await;
            return DeliveryPath::SafetyReread;
        };
        let path = tokio::select! {
            signal = listener.wait() => {
                if signal == Wakeup::Silent {
                    tokio::time::sleep(REREAD_INTERVAL).await;
                    DeliveryPath::SafetyReread
                } else {
                    DeliveryPath::WakeUp
                }
            }
            () = tokio::time::sleep(REREAD_INTERVAL) => DeliveryPath::SafetyReread
        };
        if matches!(path, DeliveryPath::WakeUp) {
            self.trace("wake-up-received", None, Some(self.last_emitted))
                .with_detail("deliveryPath", serde_json::json!(path.as_str()))
                .with_detail(
                    "wakeupAuthority",
                    serde_json::json!(self.service.wakeup().authority_instance()),
                )
                .record();
        }
        path
    }

    /// Publish rows in cursor order, refusing history this build cannot read
    /// rather than reshaping it into a plausible frame.
    fn push_events(&mut self, rows: Vec<StatusEventRecord>) -> Result<(), ()> {
        for row in rows {
            if row.payload_version > SUPPORTED_PAYLOAD_VERSION {
                self.fail(
                    failure_code::EVENT_VERSION,
                    "A retained status event uses an unsupported payload version.",
                );
                return Err(());
            }
            let Some(event) = RunStatusEvent::from_record(row, &self.public_project_id) else {
                self.fail(
                    failure_code::INVALID_HISTORY,
                    "A retained status event could not be read.",
                );
                return Err(());
            };
            self.pending
                .push_back(RunStatusFrame::RunStatusEvent(event));
        }
        Ok(())
    }
}

enum Replay {
    Delivered,
    Reset(&'static str),
    Failed,
}

const STORAGE_MESSAGE: &str = "The durable status history could not be read.";
