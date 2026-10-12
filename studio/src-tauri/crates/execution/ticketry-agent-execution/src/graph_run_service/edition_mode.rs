//! The execution mode a press arms in the compiled edition (CODING-2865).

use crate::execution::graph::ExecutionMode;
use ticketry_edition::EditionCapability;

use super::{GraphRunServiceError, GraphRunServiceErrorCode};

/// Resolve a press's requested mode. An omitted mode arms parallel where the
/// edition grants parallel subtree runs and serial elsewhere; editions without
/// them refuse an explicit parallel press. Advancement never comes here, so a
/// persisted Graph Run keeps the mode it was armed with.
pub(super) fn press_mode(
    requested: Option<ExecutionMode>,
) -> Result<ExecutionMode, GraphRunServiceError> {
    let parallel_granted = ticketry_edition::has(EditionCapability::ParallelSubtreeRuns);
    match requested {
        Some(ExecutionMode::Parallel) if !parallel_granted => Err(GraphRunServiceError::new(
            GraphRunServiceErrorCode::EditionCapabilityUnavailable,
            "edition_capability_unavailable",
            format!(
                "Parallel subtree runs are not available in the {} edition.",
                ticketry_edition::EDITION.name()
            ),
        )),
        Some(mode) => Ok(mode),
        None if parallel_granted => Ok(ExecutionMode::Parallel),
        None => Ok(ExecutionMode::Serial),
    }
}
