//! Reads trace records out of the development log's text.
//!
//! Both halves of the application already write their records to the same log,
//! the backend directly and the frontend through its forwarded standard output.
//! Each line ends with the record's JSON object, so scanning for the marker and
//! parsing the remainder recovers both halves without a new transport.

use super::record::LaunchTraceRecord;

const MARKER: &str = "launch-discovery";

/// Every trace record the log text contains, in the order the lines appear.
///
/// Lines that are not trace records, and records that cannot be parsed, are
/// skipped: a log is shared with everything else the application writes.
pub fn records_from_log(text: &str) -> Vec<LaunchTraceRecord> {
    text.lines().filter_map(record_from_line).collect()
}

fn record_from_line(line: &str) -> Option<LaunchTraceRecord> {
    let marker = line.find(MARKER)?;
    let object = line[marker + MARKER.len()..].find('{')?;
    let payload = &line[marker + MARKER.len() + object..];
    let value = serde_json::from_str(payload).ok()?;
    LaunchTraceRecord::from_value(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_halves_of_the_trace_are_read_from_the_same_log() {
        let log = concat!(
            "2026-08-31T08:45:14.000Z [backend][info] launch-discovery ",
            r#"{"event":"launch-transaction-committed","timestamp":"2026-08-31T08:45:13.000Z","#,
            r#""launchAttemptId":"attempt-1","agentRunId":"run-1"}"#,
            "\n",
            "2026-08-31T08:45:14.066Z [frontend:stdout] [frontend][info] [launch-discovery] ",
            r#"{"event":"graphql-frame-received","timestamp":"2026-08-31T08:45:13.879Z","#,
            r#""agentRunId":"run-1","frameType":"snapshot"}"#,
            "\n",
            "2026-08-31T08:45:14.100Z [backend][info] file-logging-enabled\n",
        );

        let records = records_from_log(log);

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].event, "launch-transaction-committed");
        assert_eq!(records[0].launch_attempt_id.as_deref(), Some("attempt-1"));
        assert_eq!(records[1].event, "graphql-frame-received");
    }

    #[test]
    fn a_truncated_record_is_skipped_rather_than_ending_the_read() {
        let log = concat!(
            "x launch-discovery {\"event\":\"launch-requested\"\n",
            "y launch-discovery ",
            r#"{"event":"launch-requested","timestamp":"2026-08-31T08:45:13.000Z"}"#,
            "\n",
        );

        let records = records_from_log(log);

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].event, "launch-requested");
    }
}
