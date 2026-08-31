#![allow(non_snake_case)]

use sea_orm::DatabaseConnection;
use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use ticketry_entities::runs::agent_run;

use super::ResumableConversationService;

pub struct ResumableTerminalQueries;

#[CustomFields]
impl ResumableTerminalQueries {
    async fn resumable_terminal_sessions(
        ctx: &Context<'_>,
        task_id: Option<String>,
        project_id: Option<String>,
        module_id: Option<String>,
    ) -> Result<Vec<agent_run::Model>> {
        let database = ctx
            .data::<DatabaseConnection>()
            .map_err(|_| unavailable())?;
        ResumableConversationService::new(database.clone())
            .list(task_id, project_id, module_id)
            .await
            .map_err(query_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_query::<ResumableTerminalQueries>();
    builder
}

fn unavailable() -> Error {
    Error::new("Resumable terminal sessions are unavailable.")
        .extend_with(|_, extension| extension.set("code", "resume_unavailable"))
}

fn query_error(error: sea_orm::DbErr) -> Error {
    let code = if error.to_string().contains("scope is invalid") {
        "resume_wrong_scope"
    } else {
        "resume_storage_failed"
    };
    Error::new("Resumable terminal sessions could not be listed.")
        .extend_with(|_, extension| extension.set("code", code))
}
