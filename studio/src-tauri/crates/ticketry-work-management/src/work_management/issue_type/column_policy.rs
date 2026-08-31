use std::sync::Arc;

use sea_orm::{EntityName, IdenStatic};
use seaography::{async_graphql::dynamic::TypeRef, BuilderContext, EntityColumnId};

use ticketry_entities::work_management::issue_type;

const INSERT_SERVER_COLUMNS: &[issue_type::Column] = &[
    issue_type::Column::Id,
    issue_type::Column::SortOrder,
    issue_type::Column::StartStateId,
    issue_type::Column::WorkflowRevision,
    issue_type::Column::IsPathfind,
    issue_type::Column::CreatedAt,
    issue_type::Column::UpdatedAt,
];

const UPDATE_SERVER_COLUMNS: &[issue_type::Column] = &[
    issue_type::Column::Id,
    issue_type::Column::ProjectId,
    issue_type::Column::Level,
    issue_type::Column::StartStateId,
    issue_type::Column::WorkflowRevision,
    issue_type::Column::IsPathfind,
    issue_type::Column::CreatedAt,
    issue_type::Column::UpdatedAt,
];

pub(super) fn apply(context: &mut BuilderContext) {
    for column in INSERT_SERVER_COLUMNS {
        context
            .entity_input
            .insert_skips
            .push(input_name(context, *column));
    }
    for column in UPDATE_SERVER_COLUMNS {
        context
            .entity_input
            .update_skips
            .push(input_name(context, *column));
    }

    // Django permits an omitted or null color and stores an empty string.
    // Seaography otherwise requires this non-null database column on insert.
    let color = context
        .types
        .column_options
        .entry(EntityColumnId::of::<issue_type::Entity>(
            &issue_type::Column::Color,
        ))
        .or_default();
    color.input_type = Some(TypeRef::named(TypeRef::STRING));
    color.input_conversion = Some(Arc::new(|value| {
        let color = if value.is_null() {
            String::new()
        } else {
            value.string()?.to_owned()
        };
        Ok(sea_orm::Value::String(Some(color)))
    }));
}

fn input_name(context: &BuilderContext, column: issue_type::Column) -> String {
    let type_name = (context.entity_object.type_name)(issue_type::Entity.table_name());
    let field = (context.entity_object.column_name)(&type_name, column.as_str());
    format!("{type_name}.{field}")
}
