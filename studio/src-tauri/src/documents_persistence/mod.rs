//! Migration-safe persistence boundary for the Design Document registry.
//!
//! This module adopts Django's `design_documents` table in place and
//! establishes the generated Seaography contract that later document behaviour
//! builds on. It deliberately owns no filesystem behaviour: discovery, asset
//! reads, and digest-guarded saves arrive with their own tickets, and they
//! consume the entity, field policy, and adoption evidence declared here.
//!
//! Reads are generated. The Design Document entity is registered with
//! Seaography, so listing, filtering, ordering, pagination, and model output
//! come from the framework rather than from a mirrored DTO or a pass-through
//! repository. Writes are not: the generated mutation bundle stays private for
//! the reasons recorded in [`generated_mutation_audit`].

mod adoption;
pub mod column_policy;
mod error;
pub mod generated_mutation_audit;
pub mod ownership_manifest;
mod schema;

pub use adoption::{adopt, documents_adopted, preflight, AdoptionEvidence, SourceClassification};
pub use error::{DocumentsPersistenceError, DocumentsPersistenceErrorCode};
pub use schema::{AUTHORED_TABLES, CURRENT_DJANGO_LEAF, LEDGER_TABLE, VERSION};

/// Register the generated Design Document read contract on the composed schema.
pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    crate::entities::documents::register_entity_modules(builder)
}
