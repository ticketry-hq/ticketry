//! Advisory skill visibility for the provider's actual launch directory.
use serde_json::json;
use std::path::Path;
use ticketry_provider::{
    check_skill_availability, Provider, SkillAvailabilityRequest, SkillAvailabilityStatus,
    SkillSearchEnvironment,
};

/// Returns an advisory report only when at least one skill is missing or unchecked.
/// This observes the same provider roots as workflow configuration and never installs skills.
pub fn stage_skill_warning(
    provider: Provider,
    directory: Option<&Path>,
    names: &[String],
    environment: &SkillSearchEnvironment,
) -> Option<String> {
    if names.is_empty() {
        return None;
    }
    if directory.is_none() {
        let reason = "The provider working directory could not be checked.";
        return Some(json!({"status":"unchecked","code":"launch_directory_unchecked","message":reason,
            "provider":provider.slug(),"searched_roots":[],
            "skills":names.iter().map(|name| json!({"requested":name,"status":"unchecked","installed_name":null,"location":null,"reason":reason})).collect::<Vec<_>>() }).to_string());
    }
    let report = check_skill_availability(&SkillAvailabilityRequest {
        provider,
        working_root: directory.map(Path::to_owned),
        names: names.to_owned(),
        environment: environment.clone(),
    });
    if report
        .skills
        .iter()
        .all(|skill| skill.status == SkillAvailabilityStatus::Available)
    {
        return None;
    }
    let skills = report.skills.into_iter().map(|skill| {
        let (status, reason) = match skill.status {
            SkillAvailabilityStatus::Available => ("available", None),
            SkillAvailabilityStatus::Missing => ("missing", None),
            SkillAvailabilityStatus::Unchecked { reason } => ("unchecked", Some(reason)),
        };
        json!({"requested": skill.requested, "status": status, "installed_name": skill.installed_name,
            "location": skill.location.map(|path| path.display().to_string()), "reason": reason})
    }).collect::<Vec<_>>();
    Some(json!({"status":"checked", "code":null, "message":null, "provider":provider.slug(),
        "searched_roots":report.searched_roots.iter().map(|path| path.display().to_string()).collect::<Vec<_>>(), "skills":skills}).to_string())
}
