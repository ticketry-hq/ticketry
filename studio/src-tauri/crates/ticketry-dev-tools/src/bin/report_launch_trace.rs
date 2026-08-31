//! Development reader: renders launch traces from the development log.
//!
//! Usage:
//!   report_launch_trace [<log path>] [--agent-run <id>] [--attempt <id>]
//!
//! The default log path is the development log this repository's runtime
//! scripts write. The reader itself is pure; this binary is only the file read
//! and the printing around it.

use std::path::PathBuf;

use ticketry_diagnostics::{
    correlate_launch_traces, launch_trace_for_agent_run, launch_trace_for_launch_attempt,
    launch_trace_records_from_log, render_launch_trace,
};

const DEFAULT_LOG: &str = ".ticketry-dev/logs/ticketry.log";

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let selection = selected_identity(&arguments);
    let path = arguments
        .iter()
        .find(|argument| !argument.starts_with("--"))
        .filter(|argument| Some(argument.as_str()) != selection.identity())
        .map(PathBuf::from)
        .unwrap_or_else(default_log_path);

    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("could not read {}: {error}", path.display());
            std::process::exit(1);
        }
    };

    let records = launch_trace_records_from_log(&text);
    if records.is_empty() {
        println!("no launch-trace records in {}", path.display());
        return;
    }

    let reports = match selection {
        Selection::AgentRun(id) => vec![launch_trace_for_agent_run(&records, id)],
        Selection::LaunchAttempt(id) => vec![launch_trace_for_launch_attempt(&records, id)],
        Selection::Every => correlate_launch_traces(&records),
    };

    println!(
        "{} launch-trace records in {}, {} launch(es)\n",
        records.len(),
        path.display(),
        reports.len()
    );
    for report in &reports {
        println!("{}\n", render_launch_trace(report));
    }
}

enum Selection<'arguments> {
    AgentRun(&'arguments str),
    LaunchAttempt(&'arguments str),
    Every,
}

impl<'arguments> Selection<'arguments> {
    fn identity(&self) -> Option<&'arguments str> {
        match self {
            Self::AgentRun(id) | Self::LaunchAttempt(id) => Some(id),
            Self::Every => None,
        }
    }
}

fn selected_identity(arguments: &[String]) -> Selection<'_> {
    let value_after = |flag: &str| {
        arguments
            .iter()
            .position(|argument| argument == flag)
            .and_then(|index| arguments.get(index + 1))
            .map(String::as_str)
    };
    if let Some(id) = value_after("--agent-run") {
        return Selection::AgentRun(id);
    }
    if let Some(id) = value_after("--attempt") {
        return Selection::LaunchAttempt(id);
    }
    Selection::Every
}

fn default_log_path() -> PathBuf {
    let mut directory = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    loop {
        let candidate = directory.join(DEFAULT_LOG);
        if candidate.exists() {
            return candidate;
        }
        if !directory.pop() {
            return PathBuf::from(DEFAULT_LOG);
        }
    }
}
