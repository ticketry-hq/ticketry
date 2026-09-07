//! Structured elapsed-time records for one desktop process startup.

use std::sync::Mutex;
use std::time::Instant;

use serde_json::json;

use crate::desktop::environment::startup_trace_id;

/// A process-wide trace retained as managed Tauri state while services start.
pub(crate) struct DesktopStartupTrace {
    id: String,
    log: ticketry_diagnostics::FileLog,
    timing: Mutex<StartupTiming>,
}

struct StartupTiming {
    started: Instant,
    previous: Instant,
}

impl DesktopStartupTrace {
    pub(crate) fn begin(log: ticketry_diagnostics::FileLog, now: Instant) -> Self {
        let trace = Self {
            id: startup_trace_id().unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string()),
            log,
            timing: Mutex::new(StartupTiming {
                started: now,
                previous: now,
            }),
        };
        trace.record_at("process-started", now);
        trace
    }

    fn record_at(&self, stage: &str, now: Instant) {
        let mut timing = self.timing.lock().expect("startup trace lock poisoned");
        let details = json!({
            "startup_id": self.id,
            "stage": stage,
            "elapsed_ms": now.duration_since(timing.started).as_millis(),
            "duration_ms": now.duration_since(timing.previous).as_millis(),
        });
        timing.previous = now;
        if self.log.is_enabled() {
            let _ = self.log.record("startup", "info", "timeline", details);
        }
    }

    /// Record the duration since the preceding startup boundary and process start.
    pub(crate) fn record(&self, stage: &str) {
        self.record_at(stage, Instant::now());
    }
}
