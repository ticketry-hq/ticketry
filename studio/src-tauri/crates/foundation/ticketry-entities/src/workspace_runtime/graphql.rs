//! Register the generated ShipRecord read graph.
//!
//! The generated mutation bundle stays private: Seaography rc.9 registration
//! is all-or-nothing, and the audited create-one, create-batch, update, and
//! delete operations would accept caller-supplied action facts, repeat or
//! rewrite a durable receipt, or erase append-only history. Action code is
//! the sole creator and the verdict refresher is the sole updater, both behind
//! the workspace-runtime append seam and its PR-state trigger. Reads, filters,
//! ordering, pagination, and the module relation remain fully generated.

pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    use crate::ship_record as ship_record_entity;
    seaography::register_entity!(builder, ship_record_entity, mutation: false);
    builder
}
