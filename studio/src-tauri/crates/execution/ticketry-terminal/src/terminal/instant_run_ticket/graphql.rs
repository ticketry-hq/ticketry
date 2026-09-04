#![allow(non_snake_case)]

use sea_orm::DatabaseConnection;
use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{InstantRunTicket, InstantRunTicketQuery};

pub struct InstantRunTicketQueries;

#[CustomFields]
impl InstantRunTicketQueries {
    async fn instant_run_tickets(
        ctx: &Context<'_>,
        project_id: String,
        module_id: String,
    ) -> Result<Vec<InstantRunTicket>> {
        let project_id = compact_identity(&project_id, "project_id")?;
        let module_id = compact_identity(&module_id, "module_id")?;
        InstantRunTicketQuery::new(database(ctx)?.clone())
            .list(&project_id, &module_id)
            .await
            .map_err(query_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<InstantRunTicket>();
    builder.register_custom_query::<InstantRunTicketQueries>();
    builder
}

fn database<'a>(ctx: &'a Context<'a>) -> Result<&'a DatabaseConnection> {
    ctx.data::<DatabaseConnection>().map_err(|_| {
        Error::new("Instant chats are unavailable.")
            .extend_with(|_, extension| extension.set("code", "instant_run_ticket_unavailable"))
    })
}

fn compact_identity(value: &str, field: &'static str) -> Result<String> {
    uuid::Uuid::parse_str(value)
        .map(|identity| identity.simple().to_string())
        .map_err(|_| {
            Error::new("The Instant chat scope is invalid.")
                .extend_with(|_, extension| {
                    extension.set("code", "instant_run_ticket_scope_invalid")
                })
                .extend_with(|_, extension| extension.set("field", field))
        })
}

fn query_error(error: sea_orm::DbErr) -> Error {
    Error::new("Instant chats could not be loaded.")
        .extend_with(|_, extension| extension.set("code", "instant_run_ticket_read_failed"))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
