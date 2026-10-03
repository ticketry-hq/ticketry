//! Credentials one agent run may act with.
//!
//! A launched run is handed a short-lived, run-scoped grant naming exactly
//! the operations it may call. Issuing and validating that grant is a fact
//! about the Agent Run, so it lives below both the terminal that launches the
//! run and the MCP listener that later checks the credential.

mod authority;
mod grant_store;
mod sprint_policy;
pub use sprint_policy::restrict_sprint_suggestion_run_in;

pub use authority::{AuthorizationFailure, RunAuthority, RunPrincipal};
