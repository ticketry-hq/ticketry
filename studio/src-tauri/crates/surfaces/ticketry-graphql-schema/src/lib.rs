#![deny(private_bounds, private_interfaces)]

//! The assembled GraphQL surface: one schema built out of every slice.
//!
//! Every other slice registers its own entities, views, and commands. This
//! crate is where those registrations are collected into the single schema the
//! desktop shell and the MCP listener serve, and where the database behind it
//! is adopted, migrated, and gated on readiness before the first query runs.
//!
//! [`query_root`] defines the schema — the query and mutation roots, the
//! Seaography builder, and the request context every resolver reads.
//! [`graphql_foundation`] assembles it — installation, migrations, entity
//! registration, the composed command runtime, and the Tauri transport the
//! frontend talks to.

mod graphql_foundation;
mod query_root;

// The schema crate deliberately has one flat, named public contract. The
// implementation modules remain private while these re-exports preserve the
// three seams that must be assembled together: foundation initialization,
// Seaography-backed schema construction, and the migration probe migrator.
// Keeping those exports together also makes the grouped assembly exception
// explicit: migration tooling may name `Migrator`, but no migration or
// registration module path is part of the crate API.
pub use graphql_foundation::composed_commands::{
    AdoptedWorktracker, ComposedCommandRuntime, ComposedWorktracker,
};
pub use graphql_foundation::composition::{combine_with_native_handler, transport_api};
pub use graphql_foundation::error::{
    FoundationInitializationError, FoundationInitializationErrorCode,
};
pub use graphql_foundation::migrations::Migrator;
pub use graphql_foundation::{
    adopt_worktracker_and_install, export_transport_bindings, generated_schema_sdl, initialize,
    initialize_and_install, initialize_with_keybinding_settings_and_install,
    initialize_with_worktracker_and_install, initialize_with_worktracker_commands_and_install,
    FoundationRuntime, InstallationOwnership,
};
pub use query_root::{
    foundation_schema, foundation_schema_with_terminal_services, generated_contract_schema,
    keybinding_settings_schema, TerminalServices,
};
