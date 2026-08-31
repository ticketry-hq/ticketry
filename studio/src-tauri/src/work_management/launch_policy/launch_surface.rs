//! Which surface a launch-policy caller is, as the launch trace records it.
//!
//! Launch policy already models which caller asked, so the trace records that
//! rather than inventing a second vocabulary. The conversion lives here, with
//! the `CallerScope` it reads, because the trace sits below launch policy and
//! must not know what a caller scope is.

use ticketry_diagnostics::launch_trace::LaunchSurface;

use super::CallerScope;

impl From<CallerScope> for LaunchSurface {
    fn from(scope: CallerScope) -> Self {
        match scope {
            CallerScope::Interactive => Self::LaunchPicker,
            CallerScope::RunNow => Self::RunNow,
            CallerScope::AutoStart => Self::WorkflowAutoStart,
            CallerScope::Subtree => Self::DependencyGraph,
            CallerScope::Retry => Self::AutomationRetry,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_caller_scope_a_decision_carries_names_the_surface() {
        assert_eq!(
            LaunchSurface::from(CallerScope::RunNow).recorded_name(),
            "run_now"
        );
        assert_eq!(
            LaunchSurface::from(CallerScope::AutoStart).recorded_name(),
            "workflow_auto_start"
        );
        assert_eq!(
            LaunchSurface::from(CallerScope::Subtree).recorded_name(),
            "execute_dependency_graph"
        );
        assert_eq!(
            LaunchSurface::from(CallerScope::Retry).recorded_name(),
            "automation_retry"
        );
        assert_eq!(
            LaunchSurface::from(CallerScope::Interactive).recorded_name(),
            "launch_picker"
        );
    }
}
