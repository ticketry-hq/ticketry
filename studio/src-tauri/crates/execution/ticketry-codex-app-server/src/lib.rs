#![deny(private_bounds, private_interfaces)]

//! Access to Codex thread titles through one resident app-server.
//!
//! The crate owns the child process and the small JSON-RPC subset Ticketry is
//! allowed to use: `thread/read` and `thread/name/set`, and nothing that takes
//! ownership of a conversation from the interactive Codex CLI. Callers depend
//! only on the thread-titles trait, so tests can script a reply without
//! starting Codex.

mod client;
mod error;
mod thread_titles;

pub use client::CodexAppServerClient;
pub use error::CodexAppServerError;
pub use thread_titles::CodexThreadTitles;
