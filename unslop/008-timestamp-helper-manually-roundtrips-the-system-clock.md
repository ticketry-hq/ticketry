# Timestamp helper manually converts a clock value Chrono already provides

Tag: `shrink`. Confidence: high for normal application timestamps.

Location: `studio/src-tauri/crates/worktracking/ticketry-work-management/src/work_management/commands/timestamp.rs:1-8`.

The helper reads SystemTime, computes a duration since the Unix epoch, splits seconds and nanoseconds, reconstructs a Chrono timestamp, and converts it to naive UTC. This crate already depends on Chrono. Its launch-policy rejection code already uses `chrono::Utc::now().naive_utc()`.

Keep the shared helper but replace its body with `chrono::Utc::now().naive_utc()`. This removes the duration conversion, integer cast, and two expect branches.

One deliberate behavior difference needs review: the existing implementation panics for a pre-1970 system clock, whereas Chrono can represent those dates. If that rejection is an actual product requirement, retain an explicit validation rather than the conversion machinery.

Validation: compile the crate and run timestamp-dependent command tests. No public export change is needed.
