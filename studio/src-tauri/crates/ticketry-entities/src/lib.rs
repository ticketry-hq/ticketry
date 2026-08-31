//! Database entity mappings, grouped by their current migration owner.
//!
//! Every slice above this crate reads and writes rows through these mappings,
//! so the crate sits at the bottom of the workspace and depends on nothing
//! Ticketry owns. It carries the Seaography scalar adapters for the same
//! reason: every slice's GraphQL surface needs the same list shape.

pub mod documents;
pub mod execution;
pub mod foundation;
pub mod graphql_scalars;
pub mod runs;
pub mod settings;
pub mod terminals;
pub mod work_management;
pub mod workspace_runtime;
pub mod worktrees;
