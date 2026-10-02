//! Run Now refusal payloads: every precommit refusal and committed launch
//! failure carries a stable code, a remedy, and any committed result.

use ticketry_work_management::commands::CommandError;
use ticketry_work_management::launch_policy::LaunchPolicyError;

use super::{RunNowIssueType, RunNowRefusal, RunNowState};

pub(super) fn not_eligible(target: &str) -> RunNowRefusal {
    refusal(
        target.to_owned(),
        "run_now_not_eligible",
        "Run Now requires an unarchived Story in Ideas with an Implement edge.",
        Some("Refresh the Story and its workflow before trying again."),
        None,
    )
}

pub(super) fn implementation_not_configured(target: &str) -> RunNowRefusal {
    refusal(
        target.to_owned(),
        "implementation_not_configured",
        "Run Now converts the Story to Implementation, but the project has no Implementation type whose workflow includes Implement.",
        Some("Configure an Implementation task type whose workflow includes Implement."),
        None,
    )
}

pub(super) fn identity_conflict(target_id: String) -> RunNowRefusal {
    refusal(
        target_id,
        "request_identity_conflict",
        "This Run Now request identity is already bound to another target or destination.",
        Some("Start the distinct action with a new request identity."),
        None,
    )
}

pub(super) fn policy_refusal(target: &str, error: LaunchPolicyError) -> RunNowRefusal {
    let code = match error.code() {
        "module_not_found" => "module_id_required",
        value => value,
    };
    refusal(
        target.to_owned(),
        code,
        error.to_string(),
        policy_remedy(code),
        None,
    )
}

pub(super) fn policy_remedy(code: &str) -> Option<&'static str> {
    match code {
        "module_id_required" => Some("Place the Story under an active module."),
        "binding_not_configured" | "prompt_not_configured" => {
            Some("Configure the Implementation type's Implement launch binding.")
        }
        "module_folder_unusable" => Some("Configure an existing writable module folder."),
        "no_activated_providers"
        | "provider_not_activated"
        | "unknown_agent"
        | "agent_not_configured" => Some("Activate and select a supported provider."),
        "unsupported_model" | "model_required" | "unsupported_reasoning" => {
            Some("Choose a supported model and reasoning level.")
        }
        "invalid_required_skills" => Some("Fix the binding's required skills."),
        _ => None,
    }
}

const RETRY_IF_ELIGIBLE: &str = "Refresh the Story and retry only if it is still eligible.";

pub(super) fn transition_refusal(target: &str, error: CommandError) -> RunNowRefusal {
    let (code, remedy) = match error.code() {
        "human_only_transition" => ("human_only_transition", RETRY_IF_ELIGIBLE),
        "story_has_subtasks" => (
            "story_has_subtasks",
            "Start the Story's subtasks instead; Run Now is only for Stories without subtasks.",
        ),
        _ => ("transition_rejected", RETRY_IF_ELIGIBLE),
    };
    refusal(
        target.to_owned(),
        code,
        error.to_string(),
        Some(remedy),
        None,
    )
}

pub(super) fn storage_refusal(target: &str, detail: String) -> RunNowRefusal {
    refusal(
        target.to_owned(),
        "run_now_unavailable",
        detail,
        Some("Retry when WorkTracker storage is available."),
        None,
    )
}

fn normalize_launch_code(code: &str) -> &str {
    match code {
        "module_folder_unusable" => "module_folder_unusable",
        _ => "launch_unavailable",
    }
}

/// The conversion committed but its launch did not settle: report the
/// committed type and state so callers reconcile, and keep the decision
/// recoverable under the same request identity.
pub(super) fn launch_failure(
    target_id: String,
    code: &str,
    committed_state: RunNowState,
    committed_issue_type: RunNowIssueType,
) -> RunNowRefusal {
    RunNowRefusal {
        committed_issue_type: Some(committed_issue_type),
        ..refusal(
            target_id,
            normalize_launch_code(code),
            "The Story became an Implementation task in Implement, but terminal launch did not settle.",
            Some("Retry launch reconciliation for this committed task."),
            Some(committed_state),
        )
    }
}

pub(super) fn refusal(
    target_id: String,
    code: impl Into<String>,
    detail: impl Into<String>,
    remedy: Option<&str>,
    committed_state: Option<RunNowState>,
) -> RunNowRefusal {
    RunNowRefusal {
        target_id,
        code: code.into(),
        detail: detail.into(),
        remedy: remedy.map(str::to_owned),
        committed_state,
        committed_issue_type: None,
        run: None,
    }
}
