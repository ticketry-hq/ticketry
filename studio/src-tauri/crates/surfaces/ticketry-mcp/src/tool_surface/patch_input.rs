//! The three-state patch field a typed tool parameter declares when a caller
//! may leave a value alone, clear it, or set it.

use std::borrow::Cow;

use rmcp::schemars::{self, JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Deserializer};
use ticketry_work_management::commands::workflow::PatchValue;

/// Declare the field `#[serde(default)]`: a missing key stays [`Omitted`],
/// JSON `null` is [`Null`], anything else is parsed as `T`.
///
/// [`Omitted`]: PatchInput::Omitted
/// [`Null`]: PatchInput::Null
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) enum PatchInput<T> {
    #[default]
    Omitted,
    Null,
    Value(T),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for PatchInput<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<T>::deserialize(deserializer)? {
            None => Self::Null,
            Some(value) => Self::Value(value),
        })
    }
}

/// Published in the nullable-field shape the golden snapshot records:
/// `{"anyOf": [<T>, {"type": "null"}], "default": null}`.
impl<T: JsonSchema> JsonSchema for PatchInput<T> {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        format!("Patch_{}", T::schema_name()).into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        schemars::json_schema!({
            "anyOf": [generator.subschema_for::<T>(), {"type": "null"}],
            "default": null,
        })
    }
}

impl<T> From<PatchInput<T>> for PatchValue<T> {
    fn from(input: PatchInput<T>) -> Self {
        match input {
            PatchInput::Omitted => Self::Unset,
            PatchInput::Null => Self::Null,
            PatchInput::Value(value) => Self::Value(value),
        }
    }
}

#[cfg(test)]
mod tests {
    use rmcp::handler::server::tool::schema_for_input;
    use serde_json::json;

    use super::super::argument_rejection::parse;
    use super::*;

    #[derive(Deserialize, JsonSchema)]
    #[schemars(crate = "rmcp::schemars")]
    struct Patch {
        #[serde(default)]
        prompt: PatchInput<String>,
    }

    fn patch(arguments: serde_json::Value) -> Result<PatchValue<String>, serde_json::Value> {
        parse::<Patch>(arguments.as_object().unwrap().clone()).map(|patch| patch.prompt.into())
    }

    #[test]
    fn omitted_null_and_value_stay_distinct_through_to_the_domain_patch() {
        assert_eq!(patch(json!({})), Ok(PatchValue::Unset));
        assert_eq!(patch(json!({"prompt": null})), Ok(PatchValue::Null));
        assert_eq!(
            patch(json!({"prompt": "Go"})),
            Ok(PatchValue::Value("Go".to_owned()))
        );
        let rejection = patch(json!({"prompt": 3})).unwrap_err();
        assert_eq!(rejection["code"], "validation");
        assert_eq!(rejection["field"], "prompt");
    }

    #[test]
    fn a_patch_field_publishes_the_recorded_nullable_schema() {
        let schema = schema_for_input::<Patch>().unwrap();
        assert_eq!(
            schema["properties"]["prompt"],
            json!({"anyOf": [{"type": "string"}, {"type": "null"}], "default": null})
        );
        assert!(schema.get("required").is_none(), "{schema:?}");
    }
}
