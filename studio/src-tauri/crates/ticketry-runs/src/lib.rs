//! Durable Runs history and everything that writes to it.
//!
//! A Run is the record of one agent execution: what was launched, what the
//! provider reported while it worked, and how it settled. The four modules are
//! the four ways that record is reached — the persistence boundary that owns
//! it, the GraphQL views that read it, the run-scoped credential that
//! authorizes a live run's calls, and the spool that ingests provider hooks
//! into it.

pub mod authority;
pub mod graphql;
pub mod hook_spool;
pub mod persistence;
