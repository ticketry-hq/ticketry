use sea_orm::{IdenStatic, Iterable};
use seaography::BuilderContext;

use ticketry_entities::{session, viewer_lease};

pub fn apply(context: &mut BuilderContext) {
    for name in protected_names::<session::Entity>(context) {
        context.entity_input.insert_skips.push(name.clone());
        context.entity_input.update_skips.push(name);
    }
    for name in protected_names::<viewer_lease::Entity>(context) {
        context.entity_input.insert_skips.push(name.clone());
        context.entity_input.update_skips.push(name);
    }
}

fn protected_names<E>(context: &BuilderContext) -> Vec<String>
where
    E: sea_orm::EntityTrait,
    E::Column: Iterable + IdenStatic,
{
    let type_name = (context.entity_object.type_name)(E::default().table_name());
    E::Column::iter()
        .map(|column| {
            let field = (context.entity_object.column_name)(&type_name, column.as_str());
            format!("{type_name}.{field}")
        })
        .collect()
}
