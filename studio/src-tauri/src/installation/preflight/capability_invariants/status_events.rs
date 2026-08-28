//! The durable status-event ledger and its compaction watermarks.
//!
//! The ledger is append-only and cursor-ordered, and Studio converges by reading
//! forward from a cursor. A watermark claiming a cursor the ledger never issued
//! would have compaction skip past events that still exist.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "status-event-duplicate-identity",
            area: Area::Capability,
            rule: "each status event identity appears once in the ledger",
            requires: &["runs_status_events.event_id", "runs_status_events.cursor"],
            query: "SELECT one.event_id AS identity FROM runs_status_events one
                    JOIN runs_status_events other
                      ON other.event_id = one.event_id AND other.cursor <> one.cursor"
                .to_owned(),
        },
        Invariant {
            code: "status-event-payload-malformed",
            area: Area::Capability,
            rule: "every status event carries a JSON object payload and a positive version",
            requires: &[
                "runs_status_events.event_id",
                "runs_status_events.payload",
                "runs_status_events.payload_version",
            ],
            query: "SELECT event_id AS identity FROM runs_status_events
                    WHERE payload_version <= 0
                       OR NOT json_valid(payload)
                       OR json_type(payload) <> 'object'"
                .to_owned(),
        },
        Invariant {
            code: "status-event-subject-missing",
            area: Area::Capability,
            rule: "a status event about a work item names one that exists",
            requires: &[
                "runs_status_events.event_id",
                "runs_status_events.work_item_id",
                "worktracker_issue",
            ],
            query: "SELECT event.event_id AS identity FROM runs_status_events event
                    WHERE event.work_item_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM worktracker_issue item
                        WHERE item.id = event.work_item_id)"
                .to_owned(),
        },
        Invariant {
            code: "event-cursor-watermark-ahead",
            area: Area::Capability,
            rule: "a compaction watermark never claims a cursor the ledger has not issued",
            requires: &[
                "runs_project_compaction_watermarks.compacted_through_cursor",
                "runs_status_events.cursor",
            ],
            query: "SELECT mark.project_id AS identity
                    FROM runs_project_compaction_watermarks mark
                    WHERE mark.compacted_through_cursor >
                          (SELECT COALESCE(MAX(cursor), 0) FROM runs_status_events)"
                .to_owned(),
        },
    ]
}
