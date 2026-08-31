//! Work Items and the Modules they hang off: the planning model of Ticketry.
//!
//! `work_management` owns the Work Item, its Project, Issue Types, states and
//! workflow, launch policy, and the migrations that keep all of it adopted.
//! `module_links` owns the one thing a Module points at outside the database —
//! the folder on this machine that a launch will run in — which is why it is a
//! sibling here rather than a stranger somewhere else.

pub mod module_links;
pub mod work_management;
