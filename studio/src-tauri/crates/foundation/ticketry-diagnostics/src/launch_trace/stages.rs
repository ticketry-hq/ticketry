//! The ordered launch-path stage vocabulary the trace reader reports against.
//!
//! Path order is the order a launch actually travels, not the order records
//! happen to arrive. The reader sorts by this order so an out-of-order log
//! still reads as one path.

/// The stage a probe names when it emits.
///
/// Named once here, so a probe call site and the reader below cannot drift
/// apart on a spelling.
pub const REQUESTED: &str = "launch-requested";
pub const POLICY_EVALUATED: &str = "launch-policy-evaluated";
pub const AUTHORITY_RESOLVED: &str = "launch-authority-resolved";
pub const DIRECTORY_PREFLIGHTED: &str = "launch-directory-preflighted";
pub const EXECUTABLE_RESOLVED: &str = "launch-executable-resolved";
pub const PROVIDER_VALIDATED: &str = "launch-provider-validated";
pub const ARGV_MATERIALISED: &str = "launch-argv-materialised";
pub const RUNTIME_SPAWNED: &str = "terminal-runtime-spawned";
pub const PROMPT_DELIVERED: &str = "prompt-delivered";

/// Stages a launch attempt passes before its launch transaction commits.
///
/// These records carry a launch attempt identity, because no Agent Run
/// identity exists yet.
pub const PRE_COMMIT_STAGES: [&str; 3] = [REQUESTED, POLICY_EVALUATED, AUTHORITY_RESOLVED];

/// The commit itself.
///
/// `launch-transaction-committed` is the existing launch-discovery record and
/// carries the Agent Run identity. `launch-attempt-committed` is the join: the
/// one record carrying both that identity and the attempt that produced it,
/// which is what lets the reader read both halves as one path.
pub const COMMIT_STAGES: [&str; 2] = ["launch-transaction-committed", JOIN_STAGE];

/// Stages that run after the commit, while the launch is being executed.
///
/// The launch transaction commits before the provider process exists, so these
/// are the stages where a launch that "never came up" actually stops. They are
/// keyed by attempt identity like the pre-commit half.
pub const EXECUTION_STAGES: [&str; 6] = [
    DIRECTORY_PREFLIGHTED,
    EXECUTABLE_RESOLVED,
    PROVIDER_VALIDATED,
    ARGV_MATERIALISED,
    RUNTIME_SPAWNED,
    PROMPT_DELIVERED,
];

/// The launch-discovery visibility stages, unchanged.
pub const VISIBILITY_STAGES: [&str; 8] = [
    "wake-up-published",
    "wake-up-received",
    "durable-event-reread",
    "graphql-frame-delivered",
    "graphql-frame-received",
    "apollo-run-applied",
    "apollo-event-applied",
    "workspace-render-committed",
];

/// The stage that ends a complete trace.
pub const FINAL_STAGE: &str = "workspace-render-committed";

/// The stage that joins the pre-commit and post-commit halves.
pub const JOIN_STAGE: &str = "launch-attempt-committed";

/// One end-of-life record for an Agent Run that has ended.
pub const RUN_ENDED_STAGE: &str = "agent-run-ended";

/// One record for a runtime-liveness sweep, carrying its cause and count.
pub const SWEEP_STAGE: &str = "runtime-liveness-sweep-ended";

/// Position of `event` in path order, or `None` when it is not a path stage.
///
/// End-of-life records are deliberately not path stages: a run's end is
/// reported alongside the path, not inside it.
pub fn stage_index(event: &str) -> Option<usize> {
    PRE_COMMIT_STAGES
        .iter()
        .chain(COMMIT_STAGES.iter())
        .chain(EXECUTION_STAGES.iter())
        .chain(VISIBILITY_STAGES.iter())
        .position(|stage| *stage == event)
}

/// Every path stage, in path order.
pub fn path_stages() -> impl Iterator<Item = &'static str> {
    PRE_COMMIT_STAGES
        .into_iter()
        .chain(COMMIT_STAGES)
        .chain(EXECUTION_STAGES)
        .chain(VISIBILITY_STAGES)
}

/// Stages keyed by the launch attempt rather than by an Agent Run.
pub fn attempt_keyed_stages() -> impl Iterator<Item = &'static str> {
    PRE_COMMIT_STAGES.into_iter().chain(EXECUTION_STAGES)
}

/// Whether `event` belongs to the path at all.
pub fn is_path_stage(event: &str) -> bool {
    stage_index(event).is_some()
}

/// Whether `event` is recorded before an Agent Run identity exists.
pub fn is_pre_commit_stage(event: &str) -> bool {
    PRE_COMMIT_STAGES.contains(&event)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_order_runs_from_the_request_through_to_the_workspace_render() {
        assert_eq!(stage_index("launch-requested"), Some(0));
        assert!(
            stage_index("launch-requested") < stage_index(JOIN_STAGE),
            "the request must precede the commit"
        );
        assert!(
            stage_index(JOIN_STAGE) < stage_index(FINAL_STAGE),
            "the commit must precede the workspace render"
        );
        assert_eq!(
            stage_index(FINAL_STAGE),
            Some(path_stages().count() - 1),
            "the workspace render is the last stage in path order"
        );
        assert!(
            stage_index("launch-argv-materialised") > stage_index(JOIN_STAGE),
            "argv is materialised after the launch transaction commits"
        );
        assert!(
            stage_index("prompt-delivered") < stage_index("wake-up-received"),
            "the provider is started before the workspace can see the run"
        );
    }

    #[test]
    fn end_of_life_records_are_not_path_stages() {
        assert!(!is_path_stage(RUN_ENDED_STAGE));
        assert!(!is_path_stage(SWEEP_STAGE));
        assert!(!is_path_stage("something-else"));
    }

    #[test]
    fn only_the_stages_before_the_commit_precede_an_agent_run_identity() {
        assert!(is_pre_commit_stage("launch-authority-resolved"));
        assert!(!is_pre_commit_stage(JOIN_STAGE));
        assert!(!is_pre_commit_stage("wake-up-published"));
        assert!(
            !is_pre_commit_stage("prompt-delivered"),
            "the prompt travels after the commit, so it is not a pre-commit stage"
        );
    }
}
