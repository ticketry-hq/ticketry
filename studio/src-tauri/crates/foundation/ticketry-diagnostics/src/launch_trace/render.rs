//! Renders a launch-trace report as the timed text a developer reads.
//!
//! The verdict is stated, not implied: the report names the last stage reached
//! so "where it is not coming up" is the output rather than the reader's
//! inference.

use super::record::StageOutcome;
use super::report::{LaunchTraceReport, TraceVerdict};

/// One launch's report as plain text, one line per stage.
pub fn render(report: &LaunchTraceReport) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "launch attempt {} · agent run {} · provider {} · project {}",
        or_unknown(report.launch_attempt_id.as_deref()),
        or_unknown(report.agent_run_id.as_deref()),
        or_unknown(report.provider.as_deref()),
        or_unknown(report.project_id.as_deref()),
    ));
    for stage in &report.stages {
        let elapsed = match stage.elapsed_from_previous_ms {
            Some(elapsed) => format!("{elapsed:+} ms"),
            None => "start".to_owned(),
        };
        let recurrence = match stage.occurrences {
            0 | 1 => String::new(),
            count => format!(" ×{count}"),
        };
        let refusal = match (stage.outcome, stage.refusal_reason.as_deref()) {
            (StageOutcome::Refused, Some(reason)) => format!(" refused: {reason}"),
            (StageOutcome::Refused, None) => " refused".to_owned(),
            (StageOutcome::Admitted, _) => String::new(),
        };
        lines.push(format!(
            "  {} {:>10}  {}{}{}",
            stage.timestamp.to_rfc3339(),
            elapsed,
            stage.event,
            recurrence,
            refusal,
        ));
    }
    lines.push(match &report.verdict {
        TraceVerdict::Completed => format!(
            "verdict: completed in {} ms",
            report.total_elapsed_ms.unwrap_or_default()
        ),
        TraceVerdict::Refused { stage, reason } => format!(
            "verdict: refused at {stage} ({})",
            reason.as_deref().unwrap_or("no reason recorded")
        ),
        TraceVerdict::Incomplete { last_stage } => {
            format!("verdict: incomplete — last stage reached {last_stage}, no terminal record")
        }
        TraceVerdict::Empty => "verdict: no path stages recorded".to_owned(),
    });
    if let Some(end) = &report.end_of_life {
        let mut detail = format!(
            "end of life: {} at {}",
            end.origin,
            end.timestamp.to_rfc3339()
        );
        if let Some(code) = end.exit_code {
            detail.push_str(&format!(" · exit code {code}"));
        }
        if let Some(signal) = &end.terminating_signal {
            detail.push_str(&format!(" · signal {signal}"));
        }
        if let Some(count) = end.swept_run_count {
            detail.push_str(&format!(" · sweep ended {count} runs"));
        }
        lines.push(detail);
    }
    lines.join("\n")
}

fn or_unknown(value: Option<&str>) -> &str {
    value.unwrap_or("unknown")
}
