//! Live document discovery for active Agent Runs.
//!
//! An agent writes design documents while a person is watching the workspace,
//! so a document that only appears on the next manual refresh is a document
//! that appears to have been lost. This module supplies the promptness:
//! one supervised watcher per active run, folding the operating system's
//! best-effort notifications into registry settlements.
//!
//! It supplies *only* promptness. [`crate::documents`] remains the authority
//! for what a document is, which roots may be read, what a change means, and
//! which project a fact belongs to. That separation is deliberate — a watcher
//! is an optimization over rescanning, and an optimization must never be able
//! to record something rescanning could not. Every path this module observes is
//! re-read, re-authorized, and reconciled by the same code an ordinary refresh
//! runs, and every signal that notifications were lost falls back to exactly
//! that refresh.

mod debounce;
mod eligibility;
pub mod filesystem_events;
mod observed_paths;
mod supervisor;
mod watch_loop;

pub use supervisor::DocumentWatchSupervisor;
