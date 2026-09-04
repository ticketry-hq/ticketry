use seaography::async_graphql::{
    dynamic::ResolverContext, Context, Error, ErrorExtensions, Result,
};

use super::commands::{status_facts::WorkFactRecorder, CommandDatabase, CommandError};

pub async fn authoritative_work_item(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<ticketry_entities::issue::Model> {
    use sea_orm::EntityTrait;
    ticketry_entities::issue::Entity::find_by_id(compact_uuid(id))
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

pub async fn authoritative_project(
    database: &sea_orm::DatabaseConnection,
    id: &str,
) -> Result<ticketry_entities::project::Model> {
    use sea_orm::EntityTrait;
    ticketry_entities::project::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

pub async fn authoritative_transition(
    database: &sea_orm::DatabaseConnection,
    id: i64,
) -> Result<ticketry_entities::issue_type_transition::Model> {
    use sea_orm::EntityTrait;
    ticketry_entities::issue_type_transition::Entity::find_by_id(id)
        .one(database)
        .await
        .map_err(read_error)?
        .ok_or_else(authored_result_missing)
}

pub async fn authoritative_launch_binding(
    database: &sea_orm::DatabaseConnection,
    id: i64,
) -> Result<ticketry_entities::launch_binding::Model> {
    use sea_orm::EntityTrait;
    ticketry_entities::launch_binding::Entity::find_by_id(id)
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

pub fn command_database<'a>(ctx: &'a Context<'a>) -> Result<&'a sea_orm::DatabaseConnection> {
    ctx.data::<CommandDatabase>()
        .map(|database| &database.0)
        .map_err(|_| write_unavailable_error())
}

pub fn require_command_database(ctx: &ResolverContext<'_>) -> Result<()> {
    ctx.data::<CommandDatabase>()
        .map(|_| ())
        .map_err(|_| write_unavailable_error())
}

/// Returns the optional durable-fact recorder installed by schema composition.
pub fn work_facts<'a>(ctx: &'a Context<'a>) -> Option<&'a WorkFactRecorder> {
    ctx.data::<WorkFactRecorder>().ok()
}

pub fn command_error(error: CommandError) -> Error {
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

fn write_unavailable_error() -> Error {
    Error::new("WorkTracker authored commands are not enabled before write ownership transfers.")
        .extend_with(|_, extension| extension.set("code", "worktracker_write_unavailable"))
}

fn compact_uuid(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character != '-')
        .collect()
}
