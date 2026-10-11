#![allow(non_snake_case)]

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    Set, TransactionTrait,
};
use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields, CustomInputType,
};
use ticketry_entities::{agent_run, launch_material};

#[derive(CustomInputType)]
#[seaography(input_type_name = "AgentRunUpdateInput")]
struct AgentRunUpdateInput {
    conversationTitle: String,
}

struct AgentRunMutations;

#[CustomFields]
impl AgentRunMutations {
    async fn update_agent_run(
        ctx: &Context<'_>,
        id: String,
        input: AgentRunUpdateInput,
    ) -> Result<agent_run::Model> {
        let database = ctx.data::<DatabaseConnection>()?;
        update(database, &id, &input.conversationTitle).await
    }
}

pub(crate) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_input::<AgentRunUpdateInput>();
    builder.register_custom_mutation::<AgentRunMutations>();
    builder
}

async fn update(database: &DatabaseConnection, id: &str, title: &str) -> Result<agent_run::Model> {
    let title = title.trim();
    if title.is_empty() {
        return Err(typed(
            "conversation_title_invalid",
            "Enter a conversation name.",
        ));
    }
    let transaction = database.begin().await.map_err(storage)?;
    let Some((material, Some(run))) = launch_material::Entity::find()
        .find_also_related(agent_run::Entity)
        .filter(launch_material::Column::AgentRunId.eq(id))
        .filter(launch_material::Column::Scope.eq("instant"))
        .filter(launch_material::Column::DocRelPath.is_null())
        .filter(agent_run::Column::Scope.eq("instant"))
        .filter(agent_run::Column::EndedAt.is_null())
        .one(&transaction)
        .await
        .map_err(storage)?
    else {
        return Err(ineligible());
    };
    if material.issue_id != run.issue_id
        || material.project_id.trim().is_empty()
        || material.module_id.trim().is_empty()
    {
        return Err(ineligible());
    }
    // IntoActiveModel leaves existing columns Unchanged: the title is the only
    // Set field. Provider, lifecycle and durable terminal identities stay owned
    // by their existing writers.
    let mut patch = run.into_active_model();
    patch.conversation_title = Set(Some(title.to_owned()));
    let run = patch.update(&transaction).await.map_err(storage)?;
    transaction.commit().await.map_err(storage)?;
    Ok(run)
}

fn ineligible() -> Error {
    typed(
        "conversation_title_ineligible",
        "This Instant conversation cannot be renamed.",
    )
}

fn storage(_: sea_orm::DbErr) -> Error {
    typed(
        "conversation_title_write_failed",
        "The conversation name could not be saved.",
    )
}

fn typed(code: &'static str, message: &'static str) -> Error {
    Error::new(message).extend_with(|_, extension| extension.set("code", code))
}
