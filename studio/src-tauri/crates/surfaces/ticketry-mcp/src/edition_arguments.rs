//! Arguments the compiled edition withholds from otherwise shared tools.
//!
//! The registry leaves a withheld argument out of the tool's schema; dispatch
//! refuses one a caller supplies anyway, rather than silently ignoring it.

use serde_json::{Map, Value};
use ticketry_edition::EditionCapability;
use ticketry_work_management::CommandError;

/// The withheld arguments, each with the tools that carry it and the
/// capability that publishes it.
const GATED_ARGUMENTS: &[(&str, &[&str], EditionCapability)] = &[(
    "sprint",
    &["create_task", "create_sub_task", "update_task"],
    EditionCapability::SprintPlanning,
)];

/// Refuse any argument `tool` carries only in editions this build is not.
pub(super) fn refuse_withheld(
    tool: &str,
    arguments: &Map<String, Value>,
) -> Result<(), CommandError> {
    for (argument, tools, capability) in GATED_ARGUMENTS {
        if tools.contains(&tool)
            && arguments.contains_key(*argument)
            && !ticketry_edition::has(*capability)
        {
            return Err(CommandError::Rejected {
                message: format!(
                    "{argument} is not available in the {} edition.",
                    ticketry_edition::EDITION.name()
                ),
                code: "edition_capability_unavailable",
                field: Some(argument),
            });
        }
    }
    Ok(())
}
