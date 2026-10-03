//! Generated create-one view for Sprint (see the audit in `sprint/mod.rs`).

mod serializer;

use seaography::Builder;
use seaolim::{register_generated_mutations, GeneratedMutations, ViewSerializers};

use ticketry_entities::sprint;

use serializer::SprintCreateSerializer;

pub(super) fn register(builder: &mut Builder) {
    register_generated_mutations::<sprint::Entity, sprint::ActiveModel>(
        builder,
        GeneratedMutations::CREATE_ONE,
        bindings(),
    );
}

fn bindings() -> ViewSerializers {
    ViewSerializers::default().serializer::<sprint::ActiveModel, _>(SprintCreateSerializer)
}
