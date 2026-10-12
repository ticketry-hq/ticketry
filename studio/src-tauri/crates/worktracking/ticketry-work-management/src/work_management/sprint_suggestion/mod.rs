//! Restricted Sprint Suggestion mutation views and generated input policy.

use sea_orm::{EntityName, IdenStatic};
use seaography::{Builder, BuilderContext};
use ticketry_entities::sprint_suggestion;

mod views;

pub(crate) fn register_mutations(mut builder: Builder) -> Builder {
    views::register(&mut builder);
    builder
}

pub(crate) fn apply_generated_input_policy(context: &mut BuilderContext) {
    let entity = (context.entity_object.type_name)(sprint_suggestion::Entity.table_name());
    for column in [
        sprint_suggestion::Column::Id,
        sprint_suggestion::Column::SprintId,
        sprint_suggestion::Column::GoalId,
        sprint_suggestion::Column::IssueId,
        sprint_suggestion::Column::ProposedEpicId,
        sprint_suggestion::Column::Reason,
        sprint_suggestion::Column::RunId,
        sprint_suggestion::Column::CreatedAt,
    ] {
        let field = (context.entity_object.column_name)(&entity, column.as_str());
        let name = format!("{entity}.{field}");
        context.entity_input.insert_skips.push(name.clone());
        context.entity_input.update_skips.push(name);
    }
}
