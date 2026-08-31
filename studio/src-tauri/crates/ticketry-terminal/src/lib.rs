//! The live terminal a run actually happens in.
//!
//! Everything above this crate decides *what* to launch; this is where a
//! decided launch becomes a real, attached, recoverable process. [`terminal`]
//! is the slice itself: the durable session record and its GraphQL views, the
//! launch boundary that accepts an authorized request and executes it, the
//! lifecycle and reconciliation passes that keep the recorded world equal to
//! the running one across crashes and restarts, resume, output activity,
//! viewer attachment and leases, the instant-run ticket, and cleanup.
//! [`tmux_adapter`] is the one place that knows tmux — session naming,
//! hosted commands, runtime namespaces and the live inventory — so no other
//! module derives a session name for itself. [`viewer_ownership`] arbitrates
//! which viewer holds a session, and [`temporary_profile`] owns the disposable
//! agent profile a run may be given and the journal proving it was discarded.

pub mod temporary_profile;
pub mod terminal;
pub mod tmux_adapter;
pub mod viewer_ownership;
