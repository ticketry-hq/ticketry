//! Structured refusal reasons, named once so probes and reports agree.
//!
//! A refusal reason is a stable machine-readable name, never a message: the
//! messages carry Work Item and folder detail that a trace must not.

use crate::authority::LaunchAuthorityErrorCode;
use crate::planning::LaunchPlanningErrorCode;

/// The reason name for a launch-planning refusal.
pub fn planning_reason(code: LaunchPlanningErrorCode) -> &'static str {
    match code {
        LaunchPlanningErrorCode::UnknownProvider => "unknown_provider",
        LaunchPlanningErrorCode::UnsupportedModel => "unsupported_model",
        LaunchPlanningErrorCode::UnsupportedReasoning => "unsupported_reasoning",
        LaunchPlanningErrorCode::ResumeUnsupported => "resume_unsupported",
        LaunchPlanningErrorCode::InvalidResumeIdentity => "invalid_resume_identity",
        LaunchPlanningErrorCode::RequiredSkillUnavailable => "required_skill_unavailable",
        LaunchPlanningErrorCode::ExecutableUnavailable => "executable_unavailable",
        LaunchPlanningErrorCode::InvalidExecutionAuthority => "invalid_execution_authority",
        LaunchPlanningErrorCode::UnsupportedVersion => "unsupported_material_version",
    }
}

/// The reason name for a launch-authority refusal.
pub fn authority_reason(code: LaunchAuthorityErrorCode) -> &'static str {
    match code {
        LaunchAuthorityErrorCode::PolicyRejected => "policy_rejected",
        LaunchAuthorityErrorCode::Unresolvable => "unresolvable_launch_material",
        LaunchAuthorityErrorCode::UnusableFolder => "unusable_module_folder",
        LaunchAuthorityErrorCode::Storage => "storage_failure",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planning_reasons_name_the_refusal_rather_than_describing_it() {
        assert_eq!(
            planning_reason(LaunchPlanningErrorCode::ExecutableUnavailable),
            "executable_unavailable"
        );
        assert_eq!(
            planning_reason(LaunchPlanningErrorCode::UnknownProvider),
            "unknown_provider"
        );
    }

    #[test]
    fn authority_reasons_cover_every_authority_refusal() {
        for code in [
            LaunchAuthorityErrorCode::PolicyRejected,
            LaunchAuthorityErrorCode::Unresolvable,
            LaunchAuthorityErrorCode::UnusableFolder,
            LaunchAuthorityErrorCode::Storage,
        ] {
            assert!(!authority_reason(code).is_empty());
        }
    }
}
