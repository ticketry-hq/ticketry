#![allow(non_snake_case)]

use futures_util::{stream, StreamExt};
use sea_orm::DatabaseConnection;
use seaography::{
    async_graphql::{
        dynamic::{FieldValue, SubscriptionField, SubscriptionFieldFuture, TypeRef},
        Context, Error, ErrorExtensions, Result,
    },
    CustomFields,
};

use super::{InstantRunTicket, InstantRunTicketQuery, InstantRunTicketTitleService};

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

    async fn instant_run_ticket_title(
        ctx: &Context<'_>,
        agent_run_id: String,
    ) -> Result<Option<String>> {
        let Some(service) = ctx.data_opt::<InstantRunTicketTitleService>() else {
            return Ok(None);
        };
        service
            .resolve(&agent_run_id)
            .await
            .map_err(title_query_error)
    }
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<InstantRunTicket>();
    builder.register_custom_query::<InstantRunTicketQueries>();
    builder.register_subscription_field(SubscriptionField::new(
        "instant_run_ticket_title_restarted",
        TypeRef::named_nn(TypeRef::BOOLEAN),
        |ctx| {
            let receiver = ctx
                .ctx
                .data_opt::<InstantRunTicketTitleService>()
                .and_then(InstantRunTicketTitleService::subscribe_restarts);
            SubscriptionFieldFuture::new(async move {
                let Some(receiver) = receiver else {
                    return Ok(stream::pending().boxed());
                };
                Ok(stream::unfold(receiver, |mut receiver| async move {
                    loop {
                        match receiver.recv().await {
                            Ok(()) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                                return Some((Ok(FieldValue::value(true)), receiver));
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                        }
                    }
                })
                .boxed())
            })
        },
    ));
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

fn title_query_error(error: sea_orm::DbErr) -> Error {
    Error::new("The conversation title could not be loaded.")
        .extend_with(|_, extension| extension.set("code", "instant_run_ticket_title_read_failed"))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
