//! Migration-safe adoption of terminal persistence.
//!
//! Existing session, viewer-lease, and Python launch-request rows keep their
//! identities and history. Imported launch requests remain inert. Rust-owned
//! launch material and cleanup effects start empty, so adoption alone cannot
//! create or terminate a tmux runtime.

mod adoption;
pub mod aggregate_seaography_audit;
pub mod child_seaography_handoffs;
pub mod column_policy;
mod error;
mod graphql_scope;
pub mod ownership_manifest;
mod schema;

pub use adoption::{
    adopt, preflight, terminals_adopted, AdoptionEvidence, SourceClassification, TableEvidence,
};
pub use error::{TerminalPersistenceError, TerminalPersistenceErrorCode};
pub use schema::{CURRENT_DJANGO_LEAF, LEDGER_TABLE, VERSION};

/// Registration is kept behind this capability for CODING-868 to compose with
/// its mandatory project/runtime filters. CODING-865 does not publish an
/// unscoped terminal query merely to prove the generated model compiles.
pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    use crate::entities::{
        runs::agent_run,
        terminals::{session, viewer_lease},
    };

    let mut builder = builder;
    // Session owns the one public relation in this slice. Registering every
    // Agent Run provides the generated relation target. Its write bundle stays
    // private with both terminal models.
    seaography::register_entity!(builder, agent_run, mutation: false);
    seaography::register_entity!(builder, session, mutation: false);
    seaography::register_entity!(builder, viewer_lease, mutation: false);
    builder
}

pub(crate) use graphql_scope::TerminalReadScope;
