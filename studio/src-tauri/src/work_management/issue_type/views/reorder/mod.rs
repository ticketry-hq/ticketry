mod serializer;

use sea_orm::DatabaseTransaction;
use seaography::{
    async_graphql::{
        dynamic::{InputValue, ResolverContext, TypeRef},
        Result,
    },
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_set_mutation, string_argument, ModelSetWrite, PreparedModelSet,
    RestrictedModelSetMutation, RestrictedMutationField, ViewSerializers,
};

use crate::{
    entities::work_management::issue_type,
    work_management::{commands::catalog, graphql},
};

use serializer::IssueTypeReorderSerializer;

struct ReorderIssueTypes;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelSetMutation<issue_type::Entity, issue_type::ActiveModel> for ReorderIssueTypes {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelSet<issue_type::ActiveModel, issue_type::Model>> {
        let project_id = ctx.args.try_get("project_id")?.string()?;
        let ordered_ids = ctx
            .args
            .try_get("ordered_ids")?
            .list()?
            .iter()
            .map(|value| value.string().map(str::to_owned))
            .collect::<Result<Vec<_>>>()?;
        let writes = catalog::prepare_issue_type_reorder(transaction, project_id, ordered_ids)
            .await
            .map_err(graphql::command_error)?
            .into_iter()
            .map(|(model, active_model)| ModelSetWrite::Update {
                model,
                active_model,
            })
            .collect();
        Ok(PreparedModelSet::new(writes, ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_set_mutation::<issue_type::Entity, issue_type::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("reorder_issue_types", OperationType::Update)
            .argument(string_argument("project_id"))
            .argument(InputValue::new(
                "ordered_ids",
                TypeRef::named_nn_list_nn(TypeRef::STRING),
            )),
        ReorderIssueTypes,
        ViewSerializers::default()
            .serializer::<issue_type::ActiveModel, _>(IssueTypeReorderSerializer),
    );
}
