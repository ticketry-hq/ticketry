mod arrival_rank;
pub(crate) mod attachments;
pub(crate) mod blockers;
pub(crate) mod catalog;
pub(crate) mod default_project_catalog;
mod descriptions;
mod error;
pub(crate) mod fractional_rank;
pub(crate) mod hierarchy;
mod identifiers;
pub(crate) mod project_delete;
pub(crate) mod reorder;
mod review_findings;
pub(crate) mod reviewed_defaults;
pub(crate) mod sprint_create;
pub(crate) mod sprint_reorder;
pub(crate) mod sprint_selector;
mod sprint_sequence;
pub(crate) mod sprint_suggestions;
pub(crate) mod sprints;
pub(crate) mod state_configuration;
pub(crate) mod status_facts;
pub(crate) mod tags;
pub(crate) mod timestamp;
pub(crate) mod work_items;
pub(crate) mod workflow;

pub use error::CommandError;
pub(crate) use identifiers::database_uuid;

#[cfg(test)]
mod controller_tests;
#[cfg(test)]
mod sprint_selector_tests;

#[derive(Clone)]
pub struct CommandDatabase(pub sea_orm::DatabaseConnection);
