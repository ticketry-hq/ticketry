//! Which surface asked for a launch.
//!
//! A surface-specific defect is only visible as one if the surface is
//! recorded, so every entry point names itself before the launch begins.

/// The entry points that can ask for an agent launch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaunchSurface {
    /// A person chose a launch in Studio.
    LaunchPicker,
    /// The `run_now` tool moved a Story and launched it as one action.
    RunNow,
    /// The `launch_default_coding_agent` tool.
    DefaultCodingAgent,
    /// The `execute_dependency_graph` tool launched eligible children.
    DependencyGraph,
    /// A workflow state's launch binding started a run on its own.
    WorkflowAutoStart,
    /// An agent tool asked for a launch over the MCP launch ingress.
    McpLaunchIngress,
    /// A failed automated launch was retried.
    AutomationRetry,
    /// A terminal or conversation was resumed.
    Resume,
    /// Recovery, reconciliation, and other launches with no requesting person.
    Internal,
    /// No surface named itself. Recorded as unknown rather than guessed.
    Unknown,
}

impl LaunchSurface {
    /// The stable name written into the trace.
    pub fn recorded_name(self) -> &'static str {
        match self {
            Self::LaunchPicker => "launch_picker",
            Self::RunNow => "run_now",
            Self::DefaultCodingAgent => "launch_default_coding_agent",
            Self::DependencyGraph => "execute_dependency_graph",
            Self::WorkflowAutoStart => "workflow_auto_start",
            Self::McpLaunchIngress => "mcp_launch_ingress",
            Self::AutomationRetry => "automation_retry",
            Self::Resume => "resume",
            Self::Internal => "internal",
            Self::Unknown => "unknown",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_surface_records_a_distinct_name() {
        let surfaces = [
            LaunchSurface::LaunchPicker,
            LaunchSurface::RunNow,
            LaunchSurface::DefaultCodingAgent,
            LaunchSurface::DependencyGraph,
            LaunchSurface::WorkflowAutoStart,
            LaunchSurface::McpLaunchIngress,
            LaunchSurface::AutomationRetry,
            LaunchSurface::Resume,
            LaunchSurface::Internal,
            LaunchSurface::Unknown,
        ];
        let mut names: Vec<&str> = surfaces
            .iter()
            .map(|surface| surface.recorded_name())
            .collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count, "surface names must not collide");
    }
}
