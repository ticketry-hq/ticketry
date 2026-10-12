//! Recognize a selected child that another launch took while a press was
//! still launching earlier children.

use sea_orm::{DatabaseConnection, EntityTrait};
use ticketry_entities::graph_run;
use ticketry_launch::{TerminalLaunchError, TerminalLaunchErrorCode};

use crate::execution::graph::{manual_candidates, scheduling_facts, ExecutionMode, GraphAccess};

use super::claim::{compact, parse_mode};
use super::GraphRunServiceError;

/// A press selects its children once, then launches them one at a time.
/// Interactive launches take no Graph Run lock, so one may take a later child
/// first. That child's claim then fails with a launch conflict. When the
/// campaign itself is unchanged and the child now has live work or a campaign
/// claim, the press skips it. Any other conflict fails the press.
pub(super) async fn taken_by_another_launch(
    database: &DatabaseConnection,
    root_id: &str,
    access: &GraphAccess,
    mode: ExecutionMode,
    child_id: &str,
    error: &TerminalLaunchError,
) -> Result<bool, GraphRunServiceError> {
    if error.code != TerminalLaunchErrorCode::Conflict {
        return Ok(false);
    }
    let Some(graph) = graph_run::Entity::find_by_id(root_id).one(database).await? else {
        return Ok(false);
    };
    if parse_mode(&graph.execution_mode) != Some(mode) {
        return Ok(false);
    }
    let facts = scheduling_facts(database, root_id, access, None).await?;
    let Some(child) = facts
        .iter()
        .find(|facts| compact(&facts.child.id) == child_id)
    else {
        return Ok(false);
    };
    let still_selected = manual_candidates(&facts, mode)
        .iter()
        .any(|facts| compact(&facts.child.id) == child_id);
    Ok(!still_selected && (child.has_live_work || child.has_campaign_claim))
}
