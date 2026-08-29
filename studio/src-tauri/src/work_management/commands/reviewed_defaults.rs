use std::collections::{HashMap, HashSet};

use serde::Deserialize;

const REVIEWED_DEFAULTS: &str =
    include_str!("../../../resources/work-management/reviewed_defaults.json");

pub(super) fn load() -> serde_json::Result<Defaults> {
    serde_json::from_str(REVIEWED_DEFAULTS)
}

pub(crate) fn entry_skill_seeds() -> serde_json::Result<(Vec<String>, HashMap<String, String>)> {
    let defaults = load()?;
    Ok((defaults.issue_types, defaults.entry_skills))
}

pub(crate) fn state_color(name: &str) -> serde_json::Result<Option<String>> {
    Ok(load()?
        .states
        .into_iter()
        .find(|state| state.name == name)
        .map(|state| state.color))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Defaults {
    pub(super) states: Vec<StateSeed>,
    pub(super) issue_types: Vec<String>,
    pub(super) required_skills: HashMap<String, Vec<String>>,
    /// The reviewed entry skill per state name. States without one are absent.
    pub(super) entry_skills: HashMap<String, String>,
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
        assert_eq!(
            defaults.entry_skills["Grill"].as_str(),
            "grill-with-docs"
        );
        assert_eq!(defaults.entry_skills["Spec"].as_str(), "to-spec");
        assert_eq!(defaults.entry_skills["Tickets"].as_str(), "to-tickets");
        assert_eq!(defaults.entry_skills.len(), 3);
        // Every reviewed entry skill is one the same state already requires.
        for (state, skill) in &defaults.entry_skills {
            assert!(defaults.required_skills[state].contains(skill));
        }
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
