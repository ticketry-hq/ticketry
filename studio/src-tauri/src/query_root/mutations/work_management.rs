#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::commands::{
    blockers, catalog, hierarchy, reorder, status_facts::WorkFactRecorder, work_items, workflow,
    CommandDatabase, CommandError,
};
use super::graphql_patch_input::{GraphqlPatchBool, GraphqlPatchString, GraphqlPatchStringList};
use super::read_types as output;

pub struct WorkManagementMutations;

#[CustomFields]
impl WorkManagementMutations {
    async fn acknowledge_onboarding(
        ctx: &Context<'_>,
    ) -> Result<super::entities::workspace::Model> {
        let database = command_database(ctx)?;
        let id = catalog::acknowledge_onboarding(database)
            .await
            .map_err(command_error)?;
        authoritative_workspace(database, &id).await
    }

    async fn create_project(
        ctx: &Context<'_>,
        name: String,
        slug: String,
        description: Option<String>,
        workspace_slug: Option<String>,
    ) -> Result<super::entities::project::Model> {
        let database = command_database(ctx)?;
        let id = catalog::create_project(
            database,
            catalog::CreateProject {
                name,
                slug,
                description,
                workspace_slug,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_project(database, &id).await
    }

    async fn update_project(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<super::entities::project::Model> {
        let database = command_database(ctx)?;
        let id = catalog::update_project(
            database,
            catalog::UpdateProject {
                id,
                name,
                description,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_project(database, &id).await
    }

    async fn delete_project(ctx: &Context<'_>, id: String) -> Result<bool> {
        catalog::delete_project(command_database(ctx)?, &id)
            .await
            .map_err(command_error)?;
        Ok(true)
    }

    async fn create_state(
        ctx: &Context<'_>,
        project_id: String,
        name: String,
        group: String,
        color: Option<String>,
    ) -> Result<super::entities::state::Model> {
        let database = command_database(ctx)?;
        let id = catalog::create_state(
            database,
            catalog::CreateState {
                project_id: project_id.clone(),
                name,
                group,
                color,
            },
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_state(database, &id).await
    }

    async fn update_state(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        group: Option<String>,
        color: Option<String>,
        sort_order: Option<i32>,
    ) -> Result<super::entities::state::Model> {
        let database = command_database(ctx)?;
        let id = catalog::update_state(
            database,
            catalog::UpdateState {
                id,
                name,
                group,
                color,
                sort_order,
            },
            work_facts(ctx),
        )
        .await
        .map_err(command_error)?;
        authoritative_state(database, &id).await
    }

    async fn reorder_states(
        ctx: &Context<'_>,
        project_id: String,
        ordered_ids: output::StringList,
    ) -> Result<Vec<super::entities::state::Model>> {
        let database = command_database(ctx)?;
        catalog::reorder_states(database, &project_id, ordered_ids.0, work_facts(ctx))
            .await
            .map_err(command_error)?;
        authoritative_states(database, &project_id).await
    }

    async fn create_issue_type(
        ctx: &Context<'_>,
        project_id: String,
        name: String,
        level: String,
        color: Option<String>,
    ) -> Result<super::entities::issue_type::Model> {
        let database = command_database(ctx)?;
        let id = catalog::create_issue_type(
            database,
            catalog::CreateIssueType {
                project_id,
                name,
                level,
                color,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_issue_type(database, &id).await
    }

    /// Restricted IssueType patch. `start_state_id` is a workflow member, so
    /// supplying it also requires the `workflow_revision` the caller read.
    async fn update_issue_type(
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        color: Option<String>,
        sort_order: Option<i32>,
        start_state_id: Option<String>,
        workflow_revision: Option<i32>,
    ) -> Result<super::entities::issue_type::Model> {
        let database = command_database(ctx)?;
        let id = catalog::update_issue_type(
            database,
            catalog::UpdateIssueType {
                id,
                name,
                color,
                sort_order,
                start_state_id,
                workflow_revision,
            },
        )
        .await
        .map_err(command_error)?;
        authoritative_issue_type(database, &id).await
    }

    async fn delete_issue_type(
        ctx: &Context<'_>,
        id: String,
        reassign_to: Option<String>,
    ) -> Result<bool> {
        catalog::delete_issue_type(command_database(ctx)?, &id, reassign_to.as_deref())
            .await
            .map_err(command_error)?;
        Ok(true)
    }

    async fn reorder_issue_types(
        ctx: &Context<'_>,
        project_id: String,
        ordered_ids: output::StringList,
    ) -> Result<Vec<super::entities::issue_type::Model>> {
        let database = command_database(ctx)?;
        catalog::reorder_issue_types(database, &project_id, ordered_ids.0)
            .await
            .map_err(command_error)?;
        authoritative_issue_types(database, &project_id).await
    }

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
    ) -> Result<super::entities::issue::Model> {
        let database = command_database(ctx)?;
        let ordinary_patch = name.is_some() || description.is_some() || issue_type_id.is_some();
        let domain_patch_count = usize::from(!state_id.0.is_unset())
            + usize::from(!parent_id.0.is_unset())
            + usize::from(!blocked_by_ids.0.is_unset())
            + usize::from(!is_archived.0.is_unset());
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

pub(super) async fn authoritative_work_item(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<super::entities::issue::Model> {
    use sea_orm::EntityTrait;
    super::entities::issue::Entity::find_by_id(compact_uuid(id))
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

async fn authoritative_project(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<super::entities::project::Model> {
    use sea_orm::EntityTrait;
    super::entities::project::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

async fn authoritative_workspace(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<super::entities::workspace::Model> {
    use sea_orm::EntityTrait;
    super::entities::workspace::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

async fn authoritative_state(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<super::entities::state::Model> {
    use sea_orm::EntityTrait;
    super::entities::state::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

async fn authoritative_states(
    database: &sea_orm::DatabaseConnection,
    project_id: &str,
) -> Result<Vec<super::entities::state::Model>> {
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
    super::entities::state::Entity::find()
        .filter(super::entities::state::Column::ProjectId.eq(compact_uuid(project_id)))
        .order_by_asc(super::entities::state::Column::SortOrder)
        .order_by_asc(super::entities::state::Column::CreatedAt)
        .all(database)
        .await
        .map_err(read_error)
}

async fn authoritative_issue_type(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<super::entities::issue_type::Model> {
    use sea_orm::EntityTrait;
    super::entities::issue_type::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

async fn authoritative_issue_types(
    database: &sea_orm::DatabaseConnection,
    project_id: &str,
) -> Result<Vec<super::entities::issue_type::Model>> {
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
    super::entities::issue_type::Entity::find()
        .filter(super::entities::issue_type::Column::ProjectId.eq(compact_uuid(project_id)))
        .order_by_asc(super::entities::issue_type::Column::SortOrder)
        .order_by_asc(super::entities::issue_type::Column::CreatedAt)
        .all(database)
        .await
        .map_err(read_error)
}

pub(super) fn read_error(_: sea_orm::DbErr) -> Error {
    Error::new("The authored result could not be read.")
        .extend_with(|_, extension| extension.set("code", "worktracker_read_failed"))
}

pub(super) fn authored_result_missing() -> Error {
    Error::new("The authored result is unavailable.")
        .extend_with(|_, extension| extension.set("code", "not_found"))
}

pub(super) fn command_database<'a>(
    ctx: &'a Context<'a>,
) -> Result<&'a sea_orm::DatabaseConnection> {
    ctx.data::<CommandDatabase>()
        .map(|database| &database.0)
        .map_err(|_| {
            Error::new(
                "WorkTracker authored commands are not enabled before write ownership transfers.",
            )
            .extend_with(|_, extension| extension.set("code", "worktracker_write_unavailable"))
        })
}

/// The durable-fact seam for an authored write.
///
/// The composition installs it only where the outbox has been adopted, so a
/// pre-adoption or probe schema still runs every command invariant and simply
/// publishes nothing.
pub(super) fn work_facts<'a>(ctx: &'a Context<'a>) -> Option<&'a WorkFactRecorder> {
    ctx.data::<WorkFactRecorder>().ok()
}

pub(super) fn command_error(error: CommandError) -> Error {
    let code = error.code();
    let field = error.field_name();
    let from_state = error.from_state().map(str::to_owned);
    let to_state = error.to_state().map(str::to_owned);
    Error::new(error.to_string()).extend_with(move |_, extension| {
        extension.set("code", code);
        if let Some(field) = field {
            extension.set("field", field);
        }
        if matches!(
            code,
            "illegal_birth"
                | "illegal_transition"
                | "human_only_transition"
                | "unknown_state"
                | "foreign_state"
        ) {
            extension.set("from", from_state);
            extension.set("to", to_state);
        }
    })
}

pub(super) async fn authoritative_transition(
    database: &sea_orm::DatabaseConnection,
    id: i64,
) -> Result<super::entities::issue_type_transition::Model> {
    use sea_orm::EntityTrait;
    super::entities::issue_type_transition::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

pub(super) async fn authoritative_launch_binding(
    database: &sea_orm::DatabaseConnection,
    id: i64,
) -> Result<super::entities::launch_binding::Model> {
    use sea_orm::EntityTrait;
    super::entities::launch_binding::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

fn compact_uuid(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character != '-')
        .collect()
}
