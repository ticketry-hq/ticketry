use std::sync::Arc;

use sea_orm::EntityTrait;
use seaography::{
    async_graphql::dynamic::FieldValue, BuilderContext, ColumnOptions, EntityColumnId,
    LifecycleHooks, MultiLifecycleHooks,
};
use uuid::Uuid;

use crate::entities::terminals::session as terminal_session;
use crate::entities::work_management as entities;
use crate::entities::worktrees::worktree;

pub(super) fn builder_context() -> BuilderContext {
    let mut context = BuilderContext::default();

    let default_entity_type_name = std::mem::replace(
        &mut context.entity_object.type_name,
        Box::new(|_| unreachable!("the default entity type namer was replaced")),
    );
    context.entity_object.type_name = Box::new(move |entity_name| {
        if entity_name == "app_settings" {
            "KeybindingSetting".to_owned()
        } else {
            default_entity_type_name(entity_name)
        }
    });
    let default_column_name = std::mem::replace(
        &mut context.entity_object.column_name,
        Box::new(|_, _| unreachable!("the default column namer was replaced")),
    );
    context.entity_object.column_name = Box::new(move |entity_name, column_name| {
        if entity_name == "KeybindingSetting" {
            column_name.to_owned()
        } else {
            default_column_name(entity_name, column_name)
        }
    });

    add_uuid_columns::<entities::project::Entity>(
        &mut context,
        [entities::project::Column::Id],
    );
    add_uuid_columns::<entities::state::Entity>(
        &mut context,
        [
            entities::state::Column::Id,
            entities::state::Column::ProjectId,
        ],
    );
    add_uuid_columns::<entities::issue_type::Entity>(
        &mut context,
        [
            entities::issue_type::Column::Id,
            entities::issue_type::Column::ProjectId,
            entities::issue_type::Column::StartStateId,
        ],
    );
    add_uuid_columns::<entities::issue::Entity>(
        &mut context,
        [
            entities::issue::Column::Id,
            entities::issue::Column::ProjectId,
            entities::issue::Column::IssueTypeId,
            entities::issue::Column::ParentId,
            entities::issue::Column::ModuleId,
            entities::issue::Column::StateId,
        ],
    );
    add_uuid_columns::<entities::issue_blocker::Entity>(
        &mut context,
        [
            entities::issue_blocker::Column::FromIssueId,
            entities::issue_blocker::Column::ToIssueId,
        ],
    );
    add_uuid_columns::<entities::attachment::Entity>(
        &mut context,
        [
            entities::attachment::Column::Id,
            entities::attachment::Column::IssueId,
        ],
    );
    add_uuid_columns::<entities::issue_type_transition::Entity>(
        &mut context,
        [
            entities::issue_type_transition::Column::IssueTypeId,
            entities::issue_type_transition::Column::FromStateId,
            entities::issue_type_transition::Column::ToStateId,
        ],
    );
    add_uuid_columns::<entities::launch_binding::Entity>(
        &mut context,
        [
            entities::launch_binding::Column::IssueTypeId,
            entities::launch_binding::Column::StateId,
            entities::launch_binding::Column::ModelId,
            entities::launch_binding::Column::ReasoningId,
        ],
    );
    add_uuid_columns::<entities::provider::Entity>(&mut context, [entities::provider::Column::Id]);
    add_uuid_columns::<entities::agent_model::Entity>(
        &mut context,
        [
            entities::agent_model::Column::Id,
            entities::agent_model::Column::ProviderId,
        ],
    );
    add_uuid_columns::<entities::agent_model_reasoning_level::Entity>(
        &mut context,
        [
            entities::agent_model_reasoning_level::Column::AgentModelId,
            entities::agent_model_reasoning_level::Column::ReasoningLevelId,
        ],
    );
    add_uuid_columns::<entities::reasoning_level::Entity>(
        &mut context,
        [entities::reasoning_level::Column::Id],
    );
    add_uuid_columns::<worktree::Entity>(
        &mut context,
        [
            worktree::Column::Id,
            worktree::Column::TaskId,
            worktree::Column::ProjectId,
            worktree::Column::ModuleId,
        ],
    );
    add_uuid_columns::<terminal_session::Entity>(
        &mut context,
        [
            terminal_session::Column::ProjectId,
            terminal_session::Column::ModuleId,
            terminal_session::Column::TaskId,
        ],
    );
    add_uuid_columns::<crate::entities::execution::graph_run::Entity>(
        &mut context,
        [
            crate::entities::execution::graph_run::Column::RootId,
            crate::entities::execution::graph_run::Column::ModuleId,
            crate::entities::execution::graph_run::Column::ProjectId,
        ],
    );
    add_app_setting_value_column(&mut context);
    // Derived, Git-owned, and server-owned Worktree columns are never part of
    // a generated input, whatever the entity's mutation registration is.
    crate::worktree::persistence::column_policy::apply(&mut context);
    // Design Document roots and provenance leave the contract on the entity
    // itself; every remaining adopted column is skipped in generated inputs.
    crate::documents::persistence::column_policy::apply(&mut context);
    // Terminal writes remain private, but the generated inputs are still
    // denylisted centrally so later registration cannot expose lifecycle data.
    crate::terminal::persistence::column_policy::apply(&mut context);
    crate::work_management::graphql::apply_generated_input_policy(&mut context);
    context.hooks = LifecycleHooks::new(
        MultiLifecycleHooks::default()
            .add(crate::terminal::persistence::TerminalReadScope)
            .add(crate::graph_run_service::GraphRunReadScope),
    );

    context
}

fn add_app_setting_value_column(context: &mut BuilderContext) {
    use crate::entities::settings::app_settings;

    let mut options = ColumnOptions::default();
    options.output_type = Some(seaography::async_graphql::dynamic::TypeRef::named_nn(
        context.types.json_type.clone(),
    ));
    options.output_conversion = Some(Arc::new(|value| match value {
        sea_orm::Value::String(Some(value)) => {
            let value = serde_json::from_str(value)
                .map_err(|error| seaography::async_graphql::Error::new(error.to_string()))?;
            let value = seaography::async_graphql::Value::from_json(value)
                .map_err(|error| seaography::async_graphql::Error::new(error.to_string()))?;
            Ok(Some(FieldValue::value(value)))
        }
        sea_orm::Value::String(None) => Ok(None),
        value => Err(seaography::async_graphql::Error::new(format!(
            "expected a JSON string column, received {value:?}"
        ))),
    }));
    context.types.column_options.insert(
        EntityColumnId::of::<app_settings::Entity>(&app_settings::Column::Value),
        options,
    );
}

fn add_uuid_columns<T>(context: &mut BuilderContext, columns: impl IntoIterator<Item = T::Column>)
where
    T: EntityTrait,
{
    for column in columns {
        context
            .types
            .column_options
            .insert(EntityColumnId::of::<T>(&column), uuid_column_options());
    }
}

fn uuid_column_options() -> ColumnOptions {
    let mut options = ColumnOptions::default();
    options.input_conversion = Some(Arc::new(|value| {
        if value.is_null() {
            return Ok(sea_orm::Value::String(None));
        }
        let value = value.string()?;
        let compact = Uuid::parse_str(value)
            .map(|uuid| uuid.simple().to_string())
            .unwrap_or_else(|_| value.to_owned());
        Ok(sea_orm::Value::String(Some(compact)))
    }));
    options.output_conversion = Some(Arc::new(|value| match value {
        sea_orm::Value::String(Some(value)) => {
            let public = Uuid::parse_str(value)
                .map(|uuid| uuid.hyphenated().to_string())
                .unwrap_or_else(|_| value.clone());
            Ok(Some(FieldValue::value(public)))
        }
        sea_orm::Value::String(None) => Ok(None),
        value => Err(seaography::async_graphql::Error::new(format!(
            "expected a string UUID column, received {value:?}"
        ))),
    }));
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_uuid_codec_for_public_worktracker_ids() {
        let context = builder_context();
        let id = EntityColumnId::of::<entities::project::Entity>(
            &entities::project::Column::Id,
        );

        assert!(context.types.column_options.contains_key(&id));
    }
}
