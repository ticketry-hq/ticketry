#![deny(private_bounds, private_interfaces)]

//! Read-only access to Codex thread titles through one resident app-server.
//!
//! The crate owns the child process and the small JSON-RPC subset Ticketry is
//! allowed to use. Callers depend only on the title-reader trait, so tests can
//! script a reply without starting Codex.

mod client;
mod error;
mod title_reader;

pub use client::CodexAppServerClient;
pub use error::CodexAppServerError;
pub use title_reader::CodexThreadTitleReader;
