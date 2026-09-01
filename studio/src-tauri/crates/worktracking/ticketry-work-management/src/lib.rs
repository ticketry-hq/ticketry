#![deny(private_bounds, private_interfaces)]

//! Work Items and the Modules they hang off: the planning model of Ticketry.
//!
//! `work_management` owns the Work Item, its Project, Issue Types, states and
//! workflow, launch policy, and the migrations that keep all of it adopted.
//! `module_links` owns the one thing a Module points at outside the database —
//! the folder on this machine that a launch will run in — which is why it is a
//! sibling here rather than a stranger somewhere else.

mod module_links;
mod work_management;

// `module_links` and `work_management` are implementation roots. Keep their
// paths private so callers cannot couple themselves to the file layout. The
// re-exported modules below are the deliberate compatibility surface for the
// GraphQL registration, migration, command, and read seams.
/// Register the authored Module Link GraphQL reads and restricted mutations.
pub use module_links::register_graphql;
/// Feature-gated fixtures for integration tests in sibling crates. This seam
/// is intentionally absent from normal builds.
#[cfg(feature = "test-support")]
pub use module_links::test_support;
pub use module_links::{
    entities, folder_preflight, identity, import, legacy_source,
    ownership_manifest as module_links_ownership_manifest, receipt, resolution, rollback, schema,
    ImportOutcome, ImportReceipt, LinkStatus, LocalModulePath, LocalPathDefect,
    ModuleFolderRefusal, ModuleLinkError, ModuleLinkErrorCode, ModuleLinkRecord, ModuleLinkStore,
    RollbackOutcome, SkipReason, FOLDER_INVALID, NOT_LINKED, STORE_UNAVAILABLE,
};
/// Generated-GraphQL input policy and authored model mutation registration.
pub use work_management::graphql;
pub use work_management::workspace_tab_order::update as update_workspace_tab_order;
pub use work_management::{
    adoption, commands, launch_binding_entry_skill_migration, launch_policy,
    module_presentation_migration, open, open_established, open_for_commands,
    ownership_manifest as work_management_ownership_manifest, project_onboarding_migration,
    read_queries, read_types, state_database_path, workflow_color_migration,
    workspace_tab_order_migration, ReadDatabaseError,
};
