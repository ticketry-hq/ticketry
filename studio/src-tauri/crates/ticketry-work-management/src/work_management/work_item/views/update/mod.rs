//! Compatibility update view for one Work Item.
//!
//! The public field stays model-shaped while each domain patch has a focused
//! internal handler. Route selection owns the one-domain-change rule.

mod archive;
mod blockers;
mod details;
mod reparent;
mod tab_order;
mod transition;

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use crate::work_management::{
    commands::{workflow::PatchValue, CommandError},
    graphql::{
        authoritative_work_item, command_database, command_error, work_facts, GraphqlPatchBoolNullAsUnset,
        GraphqlPatchJsonNullAsUnset, GraphqlPatchString, GraphqlPatchStringListNullAsUnset,
        GraphqlPatchStringNullAsUnset,
    },
};

pub(super) struct UpdateWorkItemMutation;

#[CustomFields]
impl UpdateWorkItemMutation {
    async fn update_work_item(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        description: Option<String>,
        issue_type_id: Option<String>,
        state_id: GraphqlPatchStringNullAsUnset,
        parent_id: GraphqlPatchString,
        blocked_by_ids: GraphqlPatchStringListNullAsUnset,
        is_archived: GraphqlPatchBoolNullAsUnset,
        workspace_tab_order: GraphqlPatchJsonNullAsUnset,
    ) -> Result<ticketry_entities::issue::Model> {
        let database = command_database(ctx)?;
        let input = UpdateInput {
            id,
            name,
            description,
            issue_type_id,
            state_id: state_id.0,
            parent_id: parent_id.0,
            blocked_by_ids: blocked_by_ids.0.map(|ids| ids.0),
            is_archived: is_archived.0,
            workspace_tab_order: workspace_tab_order.0,
        };
        let path = input.path().map_err(command_error)?;
        let facts = work_facts(ctx);
        let id = match path {
            UpdatePath::Details => {
                details::apply(
                    database,
                    input.id,
                    input.name,
                    input.description,
                    input.issue_type_id,
                    facts,
                )
                .await
            }
            UpdatePath::Transition => {
                transition::apply(database, input.id, input.state_id, facts).await
            }
            UpdatePath::Reparent => {
                reparent::apply(database, input.id, input.parent_id, facts).await
            }
            UpdatePath::Blockers => blockers::apply(database, input.id, input.blocked_by_ids).await,
            UpdatePath::Archive => {
                archive::apply(database, input.id, input.is_archived, facts).await
            }
            UpdatePath::TabOrder => {
                tab_order::apply(database, input.id, input.workspace_tab_order, facts).await
            }
        }
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }
}

struct UpdateInput {
    id: String,
    name: Option<String>,
    description: Option<String>,
    issue_type_id: Option<String>,
    state_id: PatchValue<String>,
    parent_id: PatchValue<String>,
    blocked_by_ids: PatchValue<Vec<String>>,
    is_archived: PatchValue<bool>,
    workspace_tab_order: PatchValue<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpdatePath {
    Details,
    Transition,
    Reparent,
    Blockers,
    Archive,
    TabOrder,
}

impl UpdateInput {
    fn path(&self) -> std::result::Result<UpdatePath, CommandError> {
        let details =
            self.name.is_some() || self.description.is_some() || self.issue_type_id.is_some();
        let domain_patch_count = usize::from(!self.state_id.is_unset())
            + usize::from(!self.parent_id.is_unset())
            + usize::from(!self.blocked_by_ids.is_unset())
            + usize::from(!self.is_archived.is_unset())
            + usize::from(!self.workspace_tab_order.is_unset());
        if domain_patch_count > 1 || (details && domain_patch_count != 0) {
            return Err(CommandError::validation(
                "Submit one relationship, state, or archive change at a time.",
            ));
        }

        if !self.state_id.is_unset() {
            Ok(UpdatePath::Transition)
        } else if !self.parent_id.is_unset() {
            Ok(UpdatePath::Reparent)
        } else if !self.blocked_by_ids.is_unset() {
            Ok(UpdatePath::Blockers)
        } else if !self.is_archived.is_unset() {
            Ok(UpdatePath::Archive)
        } else if !self.workspace_tab_order.is_unset() {
            Ok(UpdatePath::TabOrder)
        } else {
            Ok(UpdatePath::Details)
        }
    }
}

pub(super) fn register(builder: &mut seaography::Builder) {
    builder.register_custom_mutation::<UpdateWorkItemMutation>();
}

#[cfg(test)]
mod tests {

    use super::{PatchValue, UpdateInput, UpdatePath};

    fn empty_input() -> UpdateInput {
        UpdateInput {
            id: "10000000-0000-0000-0000-000000000000".to_owned(),
            name: None,
            description: None,
            issue_type_id: None,
            state_id: PatchValue::Unset,
            parent_id: PatchValue::Unset,
            blocked_by_ids: PatchValue::Unset,
            is_archived: PatchValue::Unset,
            workspace_tab_order: PatchValue::Unset,
        }
    }

    #[test]
    fn selects_one_internal_update_path() {
        let mut details = empty_input();
        details.name = Some("Renamed".to_owned());
        assert_eq!(details.path().unwrap(), UpdatePath::Details);

        let mut transition = empty_input();
        transition.state_id = PatchValue::Value("state".to_owned());
        assert_eq!(transition.path().unwrap(), UpdatePath::Transition);

        let mut reparent = empty_input();
        reparent.parent_id = PatchValue::Null;
        assert_eq!(reparent.path().unwrap(), UpdatePath::Reparent);

        let mut blockers = empty_input();
        blockers.blocked_by_ids = PatchValue::Value(vec![]);
        assert_eq!(blockers.path().unwrap(), UpdatePath::Blockers);

        let mut archive = empty_input();
        archive.is_archived = PatchValue::Value(true);
        assert_eq!(archive.path().unwrap(), UpdatePath::Archive);

        let mut tab_order = empty_input();
        tab_order.workspace_tab_order = PatchValue::Value(serde_json::json!([]));
        assert_eq!(tab_order.path().unwrap(), UpdatePath::TabOrder);
    }

    #[test]
    fn rejects_more_than_one_update_domain() {
        let mut relationship_mix = empty_input();
        relationship_mix.parent_id = PatchValue::Null;
        relationship_mix.blocked_by_ids = PatchValue::Value(vec![]);
        assert_eq!(
            relationship_mix.path().unwrap_err().to_string(),
            "Submit one relationship, state, or archive change at a time."
        );

        let mut details_and_transition = empty_input();
        details_and_transition.description = Some("Changed".to_owned());
        details_and_transition.state_id = PatchValue::Value("state".to_owned());
        assert_eq!(
            details_and_transition.path().unwrap_err().to_string(),
            "Submit one relationship, state, or archive change at a time."
        );
    }
}
