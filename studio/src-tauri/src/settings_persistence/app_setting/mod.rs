mod views;

use seaography::{Builder, EntityObjectBuilder};

use super::entities::app_settings;

pub(super) fn register(mut builder: Builder) -> Builder {
    builder.outputs.push(
        EntityObjectBuilder {
            context: builder.context,
        }
        .to_object::<app_settings::Entity>(),
    );
    views::register(&mut builder);
    builder
}
