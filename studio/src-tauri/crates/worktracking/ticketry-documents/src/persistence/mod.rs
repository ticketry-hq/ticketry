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
mod column_policy;
mod error;
mod generated_mutation_audit;
mod ownership_manifest;
mod schema;

pub use adoption::{adopt, documents_adopted, preflight, AdoptionEvidence, SourceClassification};
pub use column_policy::apply as apply_column_policy;
pub use error::{DocumentsPersistenceError, DocumentsPersistenceErrorCode};
pub use generated_mutation_audit::FINDINGS as GENERATED_MUTATION_FINDINGS;
pub use ownership_manifest::owned_tables as document_owned_tables;
pub use ownership_manifest::{
    ADOPTED_TABLES as DOCUMENT_OWNED_TABLES, DESIGN_DOCUMENT_COLUMNS as DOCUMENT_DESIGN_COLUMNS,
    INTERNAL_ONLY_COLUMNS as DOCUMENT_INTERNAL_ONLY_COLUMNS,
    PROTECTED_COLUMNS as DOCUMENT_PROTECTED_COLUMNS, VERSION as DOCUMENT_OWNERSHIP_VERSION,
};
pub use schema::VERSION as DOCUMENT_SCHEMA_VERSION;
pub use schema::{AUTHORED_TABLES, CURRENT_DJANGO_LEAF, LEDGER_TABLE};

/// Register the generated Design Document read contract on the composed schema.
pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    ticketry_entities::register_document_entities(builder)
}
