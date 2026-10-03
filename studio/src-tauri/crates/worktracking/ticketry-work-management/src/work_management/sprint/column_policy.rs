use sea_orm::{EntityName, IdenStatic};
use seaography::BuilderContext;

use ticketry_entities::sprint;

const INSERT_SERVER_COLUMNS: &[sprint::Column] = &[
    sprint::Column::Id,
    sprint::Column::Status,
    sprint::Column::SuggestionRunId,
    sprint::Column::GoalsRevisedAt,
    sprint::Column::CreatedAt,
    sprint::Column::UpdatedAt,
];

pub(super) fn apply(context: &mut BuilderContext) {
    for column in INSERT_SERVER_COLUMNS {
        context
            .entity_input
            .insert_skips
            .push(input_name(context, *column));
    }
}

fn input_name(context: &BuilderContext, column: sprint::Column) -> String {
    let type_name = (context.entity_object.type_name)(sprint::Entity.table_name());
    let field = (context.entity_object.column_name)(&type_name, column.as_str());
    format!("{type_name}.{field}")
}
