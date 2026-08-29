#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use super::commands::{blockers, hierarchy, reorder, work_items, workflow, CommandError};
use super::patch_input::{
    GraphqlPatchBool, GraphqlPatchJson, GraphqlPatchString, GraphqlPatchStringList,
};
use super::read_types as output;
use super::support::{authoritative_work_item, command_database, command_error, work_facts};

pub struct WorkItemMutations;

#[CustomFields]
impl WorkItemMutations {
    async fn create_work_item(
        ctx: &Context<'_>,
        project_id: String,
        name: String,
        issue_type_id: String,
        description: Option<String>,
        state_id: Option<String>,
        parent_id: Option<String>,
    ) -> Result<super::entities::issue::Model> {
        let database = command_database(ctx)?;
        let id = work_items::create(
            database,
            work_items::CreateWorkItem {
                project_id,
                name,
                issue_type_id,
                description,
                state_id,
                parent_id,
            },
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn update_work_item(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        description: Option<String>,
        issue_type_id: Option<String>,
        state_id: GraphqlPatchString,
        parent_id: GraphqlPatchString,
        blocked_by_ids: GraphqlPatchStringList,
        is_archived: GraphqlPatchBool,
        workspace_tab_order: GraphqlPatchJson,
    ) -> Result<super::entities::issue::Model> {
        let database = command_database(ctx)?;
        let ordinary_patch = name.is_some() || description.is_some() || issue_type_id.is_some();
        let domain_patch_count = usize::from(!state_id.0.is_unset())
            + usize::from(!parent_id.0.is_unset())
            + usize::from(!blocked_by_ids.0.is_unset())
            + usize::from(!is_archived.0.is_unset())
            + usize::from(!workspace_tab_order.0.is_unset());
        if domain_patch_count > 1 || (ordinary_patch && domain_patch_count != 0) {
            return Err(command_error(CommandError::validation(
                "Submit one relationship, state, or archive change at a time.",
            )));
        }
        let facts = work_facts(ctx);
        let id = match state_id.0 {
            workflow::PatchValue::Value(target_state_id) => {
                workflow::transition(
                    database,
                    workflow::TransitionWorkItem {
                        id,
                        target_state_id,
                        origin: workflow::TransitionOrigin::Human,
                    },
                    facts,
                )
                .await
            }
            workflow::PatchValue::Null => Err(CommandError::field(
                "state_id",
                "A work item state cannot be cleared.",
            )),
            workflow::PatchValue::Unset => match parent_id.0 {
                workflow::PatchValue::Value(parent_id) => {
                    hierarchy::reparent(
                        database,
                        hierarchy::ReparentWorkItem {
                            id,
                            parent_id: Some(parent_id),
                            before_id: None,
                            after_id: None,
                        },
                        facts,
                    )
                    .await
                }
                workflow::PatchValue::Null => {
                    hierarchy::reparent(
                        database,
                        hierarchy::ReparentWorkItem {
                            id,
                            parent_id: None,
                            before_id: None,
                            after_id: None,
                        },
                        facts,
                    )
                    .await
                }
                workflow::PatchValue::Unset => match blocked_by_ids.0 {
                    workflow::PatchValue::Value(ids) => {
                        blockers::replace(database, &id, ids.0).await
                    }
                    workflow::PatchValue::Null => Err(CommandError::field(
                        "blocked_by_ids",
                        "Use an empty list to clear blockers.",
                    )),
                    workflow::PatchValue::Unset => match is_archived.0 {
                        workflow::PatchValue::Value(true) => {
                            work_items::archive(database, &id, facts).await
                        }
                        workflow::PatchValue::Value(false) | workflow::PatchValue::Null => {
                            Err(CommandError::field(
                                "is_archived",
                                "Archived work items cannot be restored by this patch.",
                            ))
                        }
                        workflow::PatchValue::Unset => match workspace_tab_order.0 {
                            workflow::PatchValue::Value(order) => {
                                crate::work_management::workspace_tab_order::update(
                                    database, &id, order, facts,
                                )
                                .await
                            }
                            workflow::PatchValue::Null => Err(CommandError::field(
                                "workspace_tab_order",
                                "Workspace tab order cannot be null.",
                            )),
                            workflow::PatchValue::Unset => {
                                work_items::update(
                                    database,
                                    work_items::UpdateWorkItem {
                                        id,
                                        name,
                                        description,
                                        issue_type_id,
                                    },
                                    facts,
                                )
                                .await
                            }
                        },
                    },
                },
            },
        }
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn reorder_work_item(
        ctx: &Context<'_>,
        id: String,
        before_id: Option<String>,
        after_id: Option<String>,
        initial_order_ids: Option<output::StringList>,
    ) -> Result<super::entities::issue::Model> {
        let database = command_database(ctx)?;
        let id = reorder::reorder(
            database,
            reorder::ReorderWorkItem {
                id,
                before_id,
                after_id,
                initial_order_ids: initial_order_ids.map(|ids| ids.0),
            },
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_work_item(database, &id).await
    }

    async fn delete_work_item(ctx: &Context<'_>, id: String) -> Result<bool> {
        work_items::delete(command_database(ctx)?, &id, work_facts(ctx))
            .await
            .map_err(command_error)?;
        Ok(true)
    }
}
