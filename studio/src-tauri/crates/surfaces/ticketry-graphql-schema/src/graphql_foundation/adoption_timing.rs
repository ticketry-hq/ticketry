//! Timings within database adoption, separate from the desktop stage clock.
use std::time::Instant;

pub(super) struct AdoptionTiming {
    started: Instant,
    previous: Instant,
}

impl AdoptionTiming {
    pub(super) fn new() -> Self {
        let now = Instant::now();
        Self {
            started: now,
            previous: now,
        }
    }

    pub(super) fn record(&mut self, stage: &str) {
        let now = Instant::now();
        let log = ticketry_diagnostics::process_file_log();
        if log.is_enabled() {
            let _ = log.record(
                "startup",
                "info",
                "adoption",
                serde_json::json!({
                    "stage": stage,
                    "elapsed_ms": now.duration_since(self.started).as_millis(),
                    "duration_ms": now.duration_since(self.previous).as_millis(),
                }),
            );
        }
        self.previous = now;
    }
}
