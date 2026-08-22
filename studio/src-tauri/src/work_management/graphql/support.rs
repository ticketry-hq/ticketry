use seaography::async_graphql::{Context, Error, ErrorExtensions, Result};

use super::commands::{status_facts::WorkFactRecorder, CommandDatabase, CommandError};

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

pub(super) async fn authoritative_project(
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

pub(super) async fn authoritative_workspace(
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

pub(super) async fn authoritative_state(
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

pub(super) async fn authoritative_states(
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

pub(super) async fn authoritative_issue_type(
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

pub(super) async fn authoritative_issue_types(
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

fn read_error(_: sea_orm::DbErr) -> Error {
    Error::new("The authored result could not be read.")
        .extend_with(|_, extension| extension.set("code", "worktracker_read_failed"))
}

fn authored_result_missing() -> Error {
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

/// Returns the optional durable-fact recorder installed by schema composition.
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

fn compact_uuid(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character != '-')
        .collect()
}
