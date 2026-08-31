use seaography::Builder;
use seaolim::{register_generated_mutations, GeneratedMutations, ViewSerializers};

use ticketry_entities::foundation::migration_probes;

pub(super) fn register(builder: &mut Builder) {
    register_generated_mutations::<migration_probes::Entity, migration_probes::ActiveModel>(
        builder,
        GeneratedMutations::CREATE_ONE,
        ViewSerializers::default(),
    );
}
