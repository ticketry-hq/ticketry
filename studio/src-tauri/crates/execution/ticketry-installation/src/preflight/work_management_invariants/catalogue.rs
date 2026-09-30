//! The provider catalogue and the attachments hanging off work items.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub(crate) fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "agent-model-provider-missing",
            area: Area::WorkManagement,
            rule: "every catalogued model belongs to a provider that exists",
            requires: &["worktracker_agentmodel.provider_id", "worktracker_provider"],
            query: "SELECT model.id AS identity FROM worktracker_agentmodel model
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_provider provider
                      WHERE provider.id = model.provider_id)"
                .to_owned(),
        },
        Invariant {
            code: "agent-model-reasoning-level-missing",
            area: Area::WorkManagement,
            rule: "every model-to-reasoning-level link joins rows that exist",
            requires: &[
                "worktracker_agentmodelreasoninglevel.agent_model_id",
                "worktracker_agentmodelreasoninglevel.reasoning_level_id",
                "worktracker_agentmodel",
                "worktracker_reasoninglevel",
            ],
            query: "SELECT CAST(link.id AS TEXT) AS identity
                    FROM worktracker_agentmodelreasoninglevel link
                    WHERE NOT EXISTS (
                            SELECT 1 FROM worktracker_agentmodel model
                            WHERE model.id = link.agent_model_id)
                       OR NOT EXISTS (
                            SELECT 1 FROM worktracker_reasoninglevel level
                            WHERE level.id = link.reasoning_level_id)"
                .to_owned(),
        },
        Invariant {
            code: "attachment-work-item-missing",
            area: Area::WorkManagement,
            rule: "every attachment belongs to a work item that exists",
            requires: &["worktracker_attachment.issue_id", "worktracker_issue"],
            query: "SELECT attachment.id AS identity FROM worktracker_attachment attachment
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_issue item
                      WHERE item.id = attachment.issue_id)"
                .to_owned(),
        },
    ]
}
