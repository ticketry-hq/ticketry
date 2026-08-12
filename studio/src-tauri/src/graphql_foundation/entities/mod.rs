//! `SeaORM` Entity registration adapted from sea-orm-codegen 2.0.

pub mod migration_probes;
pub mod prelude;

pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    // The probe demonstrates Ticketry's governing exception: generated reads
    // are useful, but writes go through an authored domain command.
    seaography::register_entity!(builder, migration_probes, mutation: false);
    builder
}
