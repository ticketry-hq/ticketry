use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct SuggestionOutput {
    pub suggestions: Vec<Suggestion>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Suggestion {
    pub goal_id: String,
    pub story: SuggestedStory,
    pub reason: String,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum SuggestedStory {
    Existing { issue_id: String },
    Proposed { name: String, epic_id: String },
}
impl SuggestionOutput {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > 1024 * 1024 {
            return Err("The suggestion result is too large.".into());
        }
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| "The agent returned an invalid suggestion result.")?;
        if value.suggestions.len() > 100 {
            return Err("The agent returned too many suggestions.".into());
        }
        let mut seen = HashSet::new();
        for suggestion in &value.suggestions {
            if suggestion.reason.trim().is_empty() || suggestion.reason.chars().count() > 4000 {
                return Err("Each suggestion needs a reason of at most 4000 characters.".into());
            }
            let key = match &suggestion.story {
                SuggestedStory::Existing { issue_id } => format!("existing:{issue_id}"),
                SuggestedStory::Proposed { name, epic_id } => {
                    if name.trim().is_empty() || name.chars().count() > 255 {
                        return Err(
                            "Each proposed story needs a name of at most 255 characters.".into(),
                        );
                    }
                    format!("proposed:{epic_id}:{}", name.trim().to_lowercase())
                }
            };
            if !seen.insert(key) {
                return Err("The agent returned duplicate suggestions.".into());
            }
        }
        Ok(value)
    }
}
pub(crate) fn schema() -> serde_json::Value {
    let mut schema =
        serde_json::to_value(schemars::schema_for!(SuggestionOutput)).expect("static schema");
    fn normalize(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(object) => {
                if let Some(variants) = object.remove("oneOf") {
                    object.insert("anyOf".into(), variants);
                }
                if let Some(constant) = object.remove("const") {
                    object.insert("enum".into(), serde_json::Value::Array(vec![constant]));
                }
                for child in object.values_mut() {
                    normalize(child);
                }
            }
            serde_json::Value::Array(array) => {
                for child in array {
                    normalize(child);
                }
            }
            _ => {}
        }
    }
    normalize(&mut schema);
    schema
}
