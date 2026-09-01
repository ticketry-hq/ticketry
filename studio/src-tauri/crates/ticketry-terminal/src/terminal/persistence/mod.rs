//! Migration-safe adoption of terminal persistence.
//!
//! Existing session, viewer-lease, and Python launch-request rows keep their
//! identities and history. Imported launch requests remain inert. Rust-owned
//! launch material and cleanup effects start empty, so adoption alone cannot
//! create or terminate a tmux runtime.

mod adoption;
mod aggregate_seaography_audit;
mod child_seaography_handoffs;
mod column_policy;
mod error;
mod graphql_scope;
mod ownership_manifest;
mod schema;

pub use adoption::{
    adopt, preflight, terminals_adopted, AdoptionEvidence, SourceClassification, TableEvidence,
};
pub use aggregate_seaography_audit::{
    CustomField, CustomFieldKind, RawSqlEvidence, RegisteredEntity, AUDITED_MODULES,
    CUSTOM_MUTATIONS, CUSTOM_OUTPUTS, CUSTOM_QUERIES, GENERATED_WRITES, NEEDS_PROOF,
    NON_SEAORM_CRUD_PATHS, RAW_SQL_EVIDENCE_ONLY, REGISTERED_ENTITIES, VERDICT,
};
pub use child_seaography_handoffs::{
    reconciled_handoffs, ChildHandoff, HandoffImpact, HandoffStatus, CHILD_HANDOFFS,
};
pub use column_policy::apply as apply_column_policy;
pub use error::{TerminalPersistenceError, TerminalPersistenceErrorCode};
pub use ownership_manifest::{
    owned_tables, ADOPTED_TABLES, AUTHORED_TABLES as OWNERSHIP_AUTHORED_TABLES,
    GENERATED_MUTATION_GAPS,
};
pub use schema::{
    PreservationCheck, CLEANUP_EFFECT_COLUMNS, EMPTY_DJANGO_LEAF, LAUNCH_MATERIAL_COLUMNS,
    LAUNCH_REQUEST_COLUMNS, SESSION_COLUMNS,
};
pub use schema::{CURRENT_DJANGO_LEAF, LEDGER_TABLE, VERSION};

/// Registration is kept behind this capability for CODING-868 to compose with
/// its mandatory project/runtime filters. CODING-865 does not publish an
/// unscoped terminal query merely to prove the generated model compiles.
pub fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    use ticketry_entities::{
        agent_run,
        {session, viewer_lease},
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

pub use graphql_scope::TerminalReadScope;
