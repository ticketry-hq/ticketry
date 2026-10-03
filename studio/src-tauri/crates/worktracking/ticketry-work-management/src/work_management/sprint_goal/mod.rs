use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityName, EntityTrait, IdenStatic,
    IntoActiveModel, QueryFilter, QueryOrder, Set,
};
use seaography::{
    async_graphql::{dynamic::ResolverContext, Result},
    Builder, BuilderContext, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, string_argument, ModelWrite, PreparedModelWrite,
    RestrictedModelMutation, RestrictedMutationField, ViewSerializers,
};
use ticketry_entities::{sprint, sprint_goal};

use super::{
    commands::{database_uuid, timestamp, CommandError},
    graphql::{command_error, require_command_database},
};

enum GoalWrite {
    Create,
    Update,
    Delete,
}

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<sprint_goal::Entity, sprint_goal::ActiveModel> for GoalWrite {
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> Result<PreparedModelWrite<sprint_goal::ActiveModel, sprint_goal::Model>> {
        require_command_database(ctx)?;
        let write = match self {
            Self::Create => {
                let sprint_id =
                    database_uuid(ctx.args.try_get("sprint_id")?.string()?, "sprint_id")
                        .map_err(command_error)?;
                prepare_sprint(transaction, &sprint_id)
                    .await
                    .map_err(command_error)?;
                let last = sprint_goal::Entity::find()
                    .filter(sprint_goal::Column::SprintId.eq(&sprint_id))
                    .order_by_desc(sprint_goal::Column::Position)
                    .one(transaction)
                    .await?;
                let position = match last {
                    Some(goal) => goal.position.checked_add(1).ok_or_else(|| {
                        command_error(CommandError::validation("Sprint goal ordering is full."))
                    })?,
                    None => 1,
                };
                ModelWrite::Insert(sprint_goal::ActiveModel {
                    sprint_id: Set(sprint_id),
                    position: Set(position),
                    text: Set(ctx.args.try_get("text")?.string()?.to_owned()),
                    ..Default::default()
                })
            }
            Self::Update | Self::Delete => {
                let id = database_uuid(ctx.args.try_get("id")?.string()?, "id")
                    .map_err(command_error)?;
                let goal = find_goal(transaction, &id).await.map_err(command_error)?;
                prepare_sprint(transaction, &goal.sprint_id)
                    .await
                    .map_err(command_error)?;
                let goal = find_goal(transaction, &id).await.map_err(command_error)?;
                let mut active = goal.clone().into_active_model();
                match self {
                    Self::Update => {
                        active.text = Set(ctx.args.try_get("text")?.string()?.to_owned());
                        ModelWrite::Update(active)
                    }
                    Self::Delete => ModelWrite::Delete {
                        model: goal,
                        active_model: active,
                    },
                    Self::Create => unreachable!(),
                }
            }
        };
        Ok(PreparedModelWrite::new(write, ()))
    }
}

async fn find_goal(
    transaction: &DatabaseTransaction,
    id: &str,
) -> std::result::Result<sprint_goal::Model, CommandError> {
    sprint_goal::Entity::find_by_id(id)
        .one(transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Sprint goal not found.".to_owned()))
}

async fn prepare_sprint(
    transaction: &DatabaseTransaction,
    sprint_id: &str,
) -> std::result::Result<(), CommandError> {
    let now = timestamp::now();
    // The guarded write takes the database writer lock before position allocation.
    let updated = sprint::Entity::update_many()
        .col_expr(sprint::Column::GoalsRevisedAt, Expr::value(Some(now)))
        .col_expr(sprint::Column::UpdatedAt, Expr::value(now))
        .filter(sprint::Column::Id.eq(sprint_id))
        .filter(sprint::Column::Status.ne(sprint::COMPLETED))
        .exec(transaction)
        .await?;
    if updated.rows_affected == 1 {
        return Ok(());
    }
    match sprint::Entity::find_by_id(sprint_id)
        .one(transaction)
        .await?
    {
        None => Err(CommandError::NotFound("Sprint not found.".to_owned())),
        Some(_) => Err(CommandError::validation(
            "Goals on a completed sprint cannot be changed.",
        )),
    }
}

pub(crate) fn register_mutations(mut builder: Builder) -> Builder {
    for (name, action, hook, arguments) in [
        (
            "create_sprint_goal",
            OperationType::Create,
            GoalWrite::Create,
            vec!["sprint_id", "text"],
        ),
        (
            "update_sprint_goal",
            OperationType::Update,
            GoalWrite::Update,
            vec!["id", "text"],
        ),
        (
            "delete_sprint_goal",
            OperationType::Delete,
            GoalWrite::Delete,
            vec!["id"],
        ),
    ] {
        let mut field = RestrictedMutationField::new(name, action).hook_owns_authorization();
        for argument in arguments {
            field = field.argument(string_argument(argument));
        }
        if matches!(hook, GoalWrite::Delete) {
            field = field.returns_boolean();
        }
        register_restricted_model_mutation::<sprint_goal::Entity, sprint_goal::ActiveModel, _>(
            &mut builder,
            field,
            hook,
            ViewSerializers::default(),
        );
    }
    builder
}

pub(crate) fn apply_generated_input_policy(context: &mut BuilderContext) {
    let entity = (context.entity_object.type_name)(sprint_goal::Entity.table_name());
    for column in [
        sprint_goal::Column::Id,
        sprint_goal::Column::Position,
        sprint_goal::Column::CreatedAt,
        sprint_goal::Column::UpdatedAt,
    ] {
        let field = (context.entity_object.column_name)(&entity, column.as_str());
        let name = format!("{entity}.{field}");
        context.entity_input.insert_skips.push(name.clone());
        context.entity_input.update_skips.push(name);
    }
    let field =
        (context.entity_object.column_name)(&entity, sprint_goal::Column::SprintId.as_str());
    context
        .entity_input
        .update_skips
        .push(format!("{entity}.{field}"));
}
