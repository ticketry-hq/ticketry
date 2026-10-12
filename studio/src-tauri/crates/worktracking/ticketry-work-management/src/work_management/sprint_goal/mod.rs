//! Restricted Sprint Goal mutation views and generated input policy.

use sea_orm::{EntityName, IdenStatic};
use seaography::{Builder, BuilderContext};
use ticketry_entities::sprint_goal;

mod views;

pub(crate) fn register_mutations(mut builder: Builder) -> Builder {
    views::register(&mut builder);
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
