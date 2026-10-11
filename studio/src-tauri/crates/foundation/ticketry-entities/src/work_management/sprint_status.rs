//! Canonical statuses shared by entity validation and lifecycle callers.
//! Sprint lifecycle order is planned → active → completed; transition rules
//! remain in the work-management Sprint update view because they compare
//! against the stored row.

pub const SPRINT_PLANNED: &str = "planned";
pub const SPRINT_ACTIVE: &str = "active";
pub const SPRINT_COMPLETED: &str = "completed";
pub const SPRINT_SUGGESTION_WAITING: &str = "waiting";
pub const SPRINT_SUGGESTION_ACCEPTED: &str = "accepted";
pub const SPRINT_SUGGESTION_DISMISSED: &str = "dismissed";
