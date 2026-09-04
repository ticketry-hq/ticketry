//! Render the timed launch-trace report from a development log.
//!
//! The probes on the launch path and the launch-discovery visibility stages
//! already write to one development log. This reads that log back and prints
//! one ordered, timed report per launch: the stages reached, the elapsed time
//! between them, the last stage reached, and the verdict. It is the reader the
//! CODING-1372 plan names; the log stays the raw evidence.
//!
//! ```text
//! report_launch_trace [--log PATH] [--agent-run ID | --attempt ID]
//!                     [--provider SLUG] [--verdict completed|refused|incomplete]
//!                     [--limit N] [--summary]
//! ```
//!
//! Without `--log` the reader walks up from the working directory to the first
//! `.ticketry-dev/logs/ticketry.log`, which is where `desktop:dev` writes.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ticketry_diagnostics::{
    correlate_launch_traces, launch_trace_records_from_log, render_launch_trace,
    LaunchTraceReport, TraceVerdict,
};

const DEVELOPMENT_LOG: &str = ".ticketry-dev/logs/ticketry.log";

#[derive(Debug, Default, PartialEq, Eq)]
struct Options {
    log: Option<PathBuf>,
    agent_run: Option<String>,
    attempt: Option<String>,
    provider: Option<String>,
    verdict: Option<String>,
    limit: Option<usize>,
    summary_only: bool,
}

fn main() -> ExitCode {
    let options = match parse_options(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    let log_path = match options.log.clone().or_else(|| find_development_log(&cwd())) {
        Some(path) => path,
        None => {
            eprintln!("no development log found; pass --log PATH");
            return ExitCode::from(2);
        }
    };
    let text = match std::fs::read_to_string(&log_path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("could not read {}: {error}", log_path.display());
            return ExitCode::from(2);
        }
    };
    let records = launch_trace_records_from_log(&text);
    let reports = correlate_launch_traces(&records);
    let selected = select(&reports, &options);

    println!(
        "log {} · {} trace records · {} launches · {} selected",
        log_path.display(),
        records.len(),
        reports.len(),
        selected.len()
    );
    print!("{}", summary(&selected));
    if !options.summary_only {
        for report in &selected {
            println!();
            println!("{}", render_launch_trace(report));
        }
    }
    ExitCode::SUCCESS
}

fn parse_options(args: impl IntoIterator<Item = String>) -> Result<Options, String> {
    let mut options = Options::default();
    let mut args = args.into_iter();
    while let Some(flag) = args.next() {
        let mut value = |name: &str| {
            args.next()
                .ok_or_else(|| format!("{name} needs a value"))
        };
        match flag.as_str() {
            "--log" => options.log = Some(PathBuf::from(value("--log")?)),
            "--agent-run" => options.agent_run = Some(value("--agent-run")?),
            "--attempt" => options.attempt = Some(value("--attempt")?),
            "--provider" => options.provider = Some(value("--provider")?),
            "--verdict" => {
                let verdict = value("--verdict")?;
                if !["completed", "refused", "incomplete", "empty"].contains(&verdict.as_str()) {
                    return Err(format!("unknown verdict {verdict}"));
                }
                options.verdict = Some(verdict);
            }
            "--limit" => {
                options.limit = Some(
                    value("--limit")?
                        .parse()
                        .map_err(|_| "--limit needs a number".to_owned())?,
                )
            }
            "--summary" => options.summary_only = true,
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(options)
}

fn cwd() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn find_development_log(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .map(|directory| directory.join(DEVELOPMENT_LOG))
        .find(|candidate| candidate.is_file())
}

fn verdict_name(verdict: &TraceVerdict) -> &'static str {
    match verdict {
        TraceVerdict::Completed => "completed",
        TraceVerdict::Refused { .. } => "refused",
        TraceVerdict::Incomplete { .. } => "incomplete",
        TraceVerdict::Empty => "empty",
    }
}

/// The launches the options ask for, newest last, as the correlator orders them.
fn select<'a>(reports: &'a [LaunchTraceReport], options: &Options) -> Vec<&'a LaunchTraceReport> {
    let mut selected: Vec<&LaunchTraceReport> = reports
        .iter()
        .filter(|report| match &options.agent_run {
            Some(id) => report.agent_run_id.as_deref() == Some(id.as_str()),
            None => true,
        })
        .filter(|report| match &options.attempt {
            Some(id) => report.launch_attempt_id.as_deref() == Some(id.as_str()),
            None => true,
        })
        .filter(|report| match &options.provider {
            Some(slug) => report.provider.as_deref() == Some(slug.as_str()),
            None => true,
        })
        .filter(|report| match &options.verdict {
            Some(verdict) => verdict_name(&report.verdict) == verdict,
            None => true,
        })
        .collect();
    if let Some(limit) = options.limit {
        let skip = selected.len().saturating_sub(limit);
        selected.drain(..skip);
    }
    selected
}

/// Launch counts by provider and verdict: the codex/claude asymmetry, stated.
fn summary(reports: &[&LaunchTraceReport]) -> String {
    let mut by_provider: BTreeMap<String, BTreeMap<&'static str, usize>> = BTreeMap::new();
    for report in reports {
        let provider = report.provider.clone().unwrap_or_else(|| "unknown".to_owned());
        *by_provider
            .entry(provider)
            .or_default()
            .entry(verdict_name(&report.verdict))
            .or_default() += 1;
    }
    let mut text = String::new();
    for (provider, verdicts) in by_provider {
        let detail: Vec<String> = verdicts
            .iter()
            .map(|(verdict, count)| format!("{verdict} {count}"))
            .collect();
        text.push_str(&format!("  {provider}: {}\n", detail.join(", ")));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn options_name_the_launch_and_the_log() {
        let options = parse_options(args(&[
            "--log", "/tmp/dev.log", "--agent-run", "run-1", "--provider", "claude", "--limit", "2",
        ]))
        .expect("options parse");
        assert_eq!(options.log, Some(PathBuf::from("/tmp/dev.log")));
        assert_eq!(options.agent_run.as_deref(), Some("run-1"));
        assert_eq!(options.provider.as_deref(), Some("claude"));
        assert_eq!(options.limit, Some(2));
    }

    #[test]
    fn an_unknown_verdict_or_flag_is_refused() {
        assert!(parse_options(args(&["--verdict", "slow"])).is_err());
        assert!(parse_options(args(&["--agent-run"])).is_err());
        assert!(parse_options(args(&["--bogus"])).is_err());
    }

    #[test]
    fn the_development_log_is_found_from_a_nested_directory() {
        let root = tempfile::tempdir().expect("tempdir");
        let log = root.path().join(DEVELOPMENT_LOG);
        std::fs::create_dir_all(log.parent().unwrap()).unwrap();
        std::fs::write(&log, "").unwrap();
        let nested = root.path().join("studio/src-tauri");
        std::fs::create_dir_all(&nested).unwrap();

        assert_eq!(find_development_log(&nested), Some(log));
        assert_eq!(find_development_log(Path::new("/nonexistent-root-for-test")), None);
    }

    #[test]
    fn selection_filters_by_provider_and_verdict_and_keeps_the_latest_within_the_limit() {
        let log = concat!(
            "a launch-discovery ",
            r#"{"event":"launch-requested","timestamp":"2026-09-02T13:00:00.000Z","launchAttemptId":"a1","provider":"codex","outcome":"admitted"}"#,
            "\n",
            "b launch-discovery ",
            r#"{"event":"launch-requested","timestamp":"2026-09-02T13:01:00.000Z","launchAttemptId":"a2","provider":"claude","outcome":"admitted"}"#,
            "\n",
            "c launch-discovery ",
            r#"{"event":"launch-policy-evaluated","timestamp":"2026-09-02T13:01:00.010Z","launchAttemptId":"a2","provider":"claude","outcome":"refused","refusalReason":"policy_rejected"}"#,
            "\n",
            "d launch-discovery ",
            r#"{"event":"launch-requested","timestamp":"2026-09-02T13:02:00.000Z","launchAttemptId":"a3","provider":"claude","outcome":"admitted"}"#,
            "\n",
        );
        let records = launch_trace_records_from_log(log);
        let reports = correlate_launch_traces(&records);
        assert_eq!(reports.len(), 3);

        let claude = select(
            &reports,
            &Options { provider: Some("claude".into()), ..Options::default() },
        );
        assert_eq!(claude.len(), 2);

        let refused = select(
            &reports,
            &Options { verdict: Some("refused".into()), ..Options::default() },
        );
        assert_eq!(refused.len(), 1);
        assert_eq!(refused[0].launch_attempt_id.as_deref(), Some("a2"));

        let latest = select(&reports, &Options { limit: Some(1), ..Options::default() });
        assert_eq!(latest[0].launch_attempt_id.as_deref(), Some("a3"));

        let text = summary(&select(&reports, &Options::default()));
        assert!(text.contains("claude: incomplete 1, refused 1"), "{text}");
        assert!(text.contains("codex: incomplete 1"), "{text}");
    }
}
