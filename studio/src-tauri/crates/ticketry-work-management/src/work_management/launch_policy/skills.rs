use std::collections::HashSet;

use serde::Deserialize;

use super::LaunchPolicyError;

const REQUIRED_SKILL_LOCK: &str = include_str!("../../../../../resources/launch/skills.lock.json");

pub(super) fn validate_skills(value: &str) -> Result<Vec<String>, LaunchPolicyError> {
    #[derive(Deserialize)]
    struct Lock {
        selected_packages: Vec<String>,
    }
    let lock: Lock = serde_json::from_str(REQUIRED_SKILL_LOCK).map_err(|_| {
        LaunchPolicyError::rejected(
            "invalid_required_skills",
            "The pinned required-skill catalog is invalid.",
        )
    })?;
    let values = serde_json::from_str::<Vec<String>>(value).map_err(|_| {
        LaunchPolicyError::rejected(
            "invalid_required_skills",
            "Required skills must be a list of identifiers.",
        )
    })?;
    let mut seen = HashSet::new();
    for identifier in &values {
        if !lock.selected_packages.contains(identifier) || !seen.insert(identifier) {
            return Err(LaunchPolicyError::rejected(
                "invalid_required_skills",
                format!("Required skill '{identifier}' is invalid or duplicated."),
            ));
        }
    }
    Ok(values)
}
