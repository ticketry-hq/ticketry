//! Migration-safe adoption of the Worktree metadata index.
//!
//! The `worktrees` table is adopted in place: existing rows keep their stable
//! identities, checkout paths, branches, base refs, and lifecycle state. The
//! database remains an index while Git stays authoritative for the actual
//! checkouts, branch tips, and clean/dirty/ahead/behind facts, so no live
//! status is persisted here.
//!
//! Adoption follows the established sequence — read-only preflight, WAL
//! checkpoint, verified snapshot, known-schema classification, semantic
//! validation, stable digest comparison, ledger installation, restart
//! verification, and refusal of any unknown schema. Callers may open only
//! explicitly supplied databases; desktop startup adopts at the Slice 4
//! one-writer handoff.
//!
//! The generated Seaography contract is the public API: reads, relations,
//! filters, ordering, pagination, inputs, and outputs are generated, and the
//! unsafe generated mutation bundle stays private with its rc.9 gaps recorded
//! in [`ownership_manifest`].

mod adoption;
pub mod column_policy;
mod error;
pub mod ownership_manifest;
pub mod pull_request_url_migration;
mod schema;

pub use adoption::{adopt, preflight, worktrees_adopted, AdoptionEvidence, SourceClassification};
pub use error::{WorktreePersistenceError, WorktreePersistenceErrorCode};
pub use schema::{ADOPTED_TABLE, CURRENT_DJANGO_LEAF, LEDGER_TABLE, VERSION};

/// Register the generated Worktree read graph in the product schema.
pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    ticketry_entities::register_worktree_entities(builder)
}
