use std::collections::{HashMap, HashSet};

use serde::Deserialize;

const REVIEWED_DEFAULTS: &str =
    include_str!("../../../resources/work-management/reviewed_defaults.json");

pub(super) fn load() -> serde_json::Result<Defaults> {
    serde_json::from_str(REVIEWED_DEFAULTS)
}

pub(crate) fn state_color(name: &str) -> serde_json::Result<Option<String>> {
    Ok(load()?
        .states
        .into_iter()
        .find(|state| state.name == name)
        .map(|state| state.color))
}

pub(crate) fn entry_skill_seeds() -> serde_json::Result<Vec<(String, String)>> {
    let defaults = load()?;
    Ok([
        ("Grill", "grill-with-docs"),
        ("Spec", "to-spec"),
        ("Tickets", "to-tickets"),
    ]
    .into_iter()
    .filter(|(state, skill)| {
        defaults
            .required_skills
            .get(*state)
            .is_some_and(|skills| skills.iter().any(|required| required == skill))
    })
    .map(|(state, skill)| (state.to_owned(), skill.to_owned()))
    .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Defaults {
    pub(super) states: Vec<StateSeed>,
    pub(super) issue_types: Vec<String>,
    pub(super) required_skills: HashMap<String, Vec<String>>,
    pub(super) prompts: HashMap<String, HashMap<String, String>>,
    pub(super) workflows: HashMap<String, WorkflowSeed>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StateSeed {
    pub(super) name: String,
    pub(super) group: String,
    pub(super) color: String,
    #[serde(default)]
    pub(super) auto_start: bool,
}

#[derive(Deserialize)]
pub(super) struct WorkflowSeed {
    pub(super) start: String,
    pub(super) states: HashSet<String>,
    pub(super) transitions: Vec<(String, String, TransitionSeed)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TransitionSeed {
    #[serde(default = "allowed")]
    pub(super) agent_allowed: bool,
}

fn allowed() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{load, Defaults, REVIEWED_DEFAULTS};

    #[test]
    fn reviewed_state_catalog_has_the_distinct_palette_and_unchanged_shape() {
        let defaults = load().expect("parse reviewed defaults");
        let states = defaults
            .states
            .iter()
            .map(|state| {
                (
                    state.name.as_str(),
                    state.group.as_str(),
                    state.color.as_str(),
                    state.auto_start,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            states,
            [
                ("Ideas", "backlog", "#60646C", true),
                ("Grill", "backlog", "#FA4D56", false),
                ("Spec", "unstarted", "#8E4EC6", true),
                ("Tickets", "unstarted", "#33B1FF", true),
                ("Implement", "started", "#F59E0B", false),
                ("Review", "started", "#08BDBA", false),
                ("Done", "completed", "#46A758", false),
                ("Cancelled", "cancelled", "#9AA4BC", false),
            ]
        );
        assert_eq!(
            defaults.issue_types,
            ["Story", "PathFind", "Implementation"]
        );
        assert_eq!(defaults.workflows["Story"].start, "Ideas");
        assert_eq!(defaults.workflows["PathFind"].start, "Spec");
        assert_eq!(defaults.workflows["Implementation"].start, "Implement");
    }

    #[test]
    fn malformed_state_color_data_does_not_parse() {
        let malformed = REVIEWED_DEFAULTS.replace("\"color\": \"#60646C\"", "\"color\": 60646");
        assert!(serde_json::from_str::<Defaults>(&malformed).is_err());
    }
}
