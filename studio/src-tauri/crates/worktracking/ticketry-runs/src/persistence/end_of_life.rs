//! Why an Agent Run ended.
//!
//! A run's end is stored as a status and a lifecycle state, and those already
//! collapse distinct causes onto one transport meaning. Origin is therefore an
//! additive dimension recorded alongside them: widening the lifecycle
//! vocabulary would change behaviour instead of observing it.
//!
//! Unattributed is a real outcome. It is written whenever no origin can be
//! established, never inferred from circumstance, so a gap in the instrument
//! looks like one.

use serde_json::Value;
use ticketry_diagnostics::{record_launch_discovery, runtime_instance, LaunchDiscoveryRecord};

/// What ended a run.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum EndOfLifeOrigin {
    /// A person stopped the run.
    PersonStopAction,
    /// The agent terminated itself through the worktracker MCP surface.
    AgentSelfTermination,
    /// A workflow or automation decision ended it.
    WorkflowDecision,
    /// The provider process exited on its own.
    ProviderProcessExit,
    /// A runtime-liveness sweep found it dead and ended it.
    RuntimeLivenessSweep,
    /// Nothing could be established.
    #[default]
    Unattributed,
}

impl EndOfLifeOrigin {
    pub fn recorded_name(self) -> &'static str {
        match self {
            Self::PersonStopAction => "person_stop_action",
            Self::AgentSelfTermination => "agent_self_termination",
            Self::WorkflowDecision => "workflow_decision",
            Self::ProviderProcessExit => "provider_process_exit",
            Self::RuntimeLivenessSweep => "runtime_liveness_sweep",
            Self::Unattributed => "unattributed",
        }
    }
}

/// Records that one run ended, and why.
pub fn record_run_ended(
    agent_run_id: &str,
    project_id: Option<&str>,
    origin: EndOfLifeOrigin,
    status: &str,
    exit_code: Option<i32>,
) {
    record_launch_discovery(
        LaunchDiscoveryRecord::new(
            "agent-run-ended",
            runtime_instance(),
            project_id,
            Some(agent_run_id),
            None,
            None,
            None,
        )
        .with_detail(
            "endOfLifeOrigin",
            Value::String(origin.recorded_name().to_owned()),
        )
        .with_detail("runStatus", Value::String(status.to_owned()))
        .with_detail(
            "exitCode",
            exit_code.map_or(Value::Null, |code| Value::from(code)),
        )
        .with_detail(
            "terminatingSignal",
            terminating_signal(exit_code)
                .map_or(Value::Null, |signal| Value::String(signal.to_owned())),
        ),
    );
}

/// Records one sweep, carrying its cause and how many runs it ended, so a
/// batch of runs ending at one instant reads as one event.
pub fn record_sweep_ended(cause: &str, ended_run_count: usize) {
    record_launch_discovery(
        LaunchDiscoveryRecord::new(
            "runtime-liveness-sweep-ended",
            runtime_instance(),
            None,
            None,
            None,
            None,
            None,
        )
        .with_detail(
            "endOfLifeOrigin",
            Value::String(
                EndOfLifeOrigin::RuntimeLivenessSweep
                    .recorded_name()
                    .to_owned(),
            ),
        )
        .with_detail("sweepCause", Value::String(cause.to_owned()))
        .with_detail("sweptRunCount", Value::from(ended_run_count)),
    );
}

/// The signal an exit code was derived from, where the shell convention makes
/// that unambiguous. The exit code itself is always recorded as observed; this
/// only names what it means.
pub fn terminating_signal(exit_code: Option<i32>) -> Option<&'static str> {
    match exit_code? {
        129 => Some("SIGHUP"),
        130 => Some("SIGINT"),
        131 => Some("SIGQUIT"),
        137 => Some("SIGKILL"),
        141 => Some("SIGPIPE"),
        143 => Some("SIGTERM"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_origin_has_a_distinct_recorded_name() {
        let origins = [
            EndOfLifeOrigin::PersonStopAction,
            EndOfLifeOrigin::AgentSelfTermination,
            EndOfLifeOrigin::WorkflowDecision,
            EndOfLifeOrigin::ProviderProcessExit,
            EndOfLifeOrigin::RuntimeLivenessSweep,
            EndOfLifeOrigin::Unattributed,
        ];
        let mut names: Vec<&str> = origins
            .iter()
            .map(|origin| origin.recorded_name())
            .collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count);
    }

    #[test]
    fn an_unestablished_origin_is_unattributed_rather_than_plausible() {
        assert_eq!(
            EndOfLifeOrigin::default(),
            EndOfLifeOrigin::Unattributed,
            "the default must be the honest one"
        );
    }

    #[test]
    fn a_signalled_termination_and_a_missing_command_stay_distinct() {
        assert_eq!(terminating_signal(Some(143)), Some("SIGTERM"));
        assert_eq!(terminating_signal(Some(137)), Some("SIGKILL"));
        assert_eq!(
            terminating_signal(Some(127)),
            None,
            "command-not-found is an exit code, not a signal"
        );
        assert_eq!(terminating_signal(Some(0)), None);
        assert_eq!(terminating_signal(None), None);
    }
}
