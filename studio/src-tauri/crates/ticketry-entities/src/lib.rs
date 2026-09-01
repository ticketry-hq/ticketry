#![deny(private_bounds, private_interfaces)]

//! Database entity mappings and the small set of generated-GraphQL seams.
//!
//! The implementation groups stay private. Generated SeaORM modules are the
//! one deliberate exception to a flat type-only facade: SeaORM callers and
//! Seaography registration need the `Entity`, `Model`, `Column`, and
//! `ActiveModel` namespaces together, so those modules are explicitly
//! re-exported at this crate root. No group such as
//! `ticketry_entities::work_management` is part of the public API. The child
//! declarations remain public inside each private group because generated
//! relation code refers to those module namespaces; the private ancestors
//! keep the group paths unreachable from outside this crate.

mod documents;
mod execution;
mod foundation;
mod graphql_scalars;
mod runs;
mod settings;
mod terminals;
mod work_management;
mod workspace_runtime;
mod worktrees;

pub use documents::{
    design_document, register_entity_modules as register_document_entities, DESIGN_DOCUMENT_OBJECT,
};
pub use execution::{
    graph_run, launch_claim, register_entity_modules as register_execution_entities,
};
pub use foundation::{migration_probes, register_entity_modules as register_foundation_entities};
pub use graphql_scalars::StringList;
pub use runs::{
    agent_run, automation_attempt, launch_effect, project_compaction_watermark, status_event,
};
pub use settings::{app_settings, module_link, MODULE_LINK_OBJECT};
pub use terminals::{cleanup_effect, launch_material, session, viewer_lease};
pub use work_management::{
    agent_model, agent_model_reasoning_level, attachment, issue, issue_blocker, issue_type,
    issue_type_transition, launch_binding, launch_policy_decision, launch_policy_rejection,
    module_presentation, project, provider, reasoning_level,
    register_entity_modules as register_work_management_entities, state, transition_occurrence,
};
pub use workspace_runtime::operation;
pub use worktrees::{register_entity_modules as register_worktree_entities, worktree};
