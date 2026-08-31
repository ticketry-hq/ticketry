//! Workspace Runtime: the Git worktrees an agent works in, and the workspace
//! surface built on top of them.
//!
//! [`worktree`] owns the lifecycle of a checkout — creating one for a Module,
//! reading its live Git status, reporting the changes and pull request it
//! carries, and discarding it — together with the adopted persistence tables
//! that make a worktree a durable fact rather than a directory that happens to
//! exist. [`workspace`] is the surface the product presents over those
//! checkouts: the GraphQL views, the journalled operations that mutate them,
//! the document-save path, and the ownership handoff that proves the Rust side
//! owns the tables it writes.
//!
//! The two ship as one crate because the coupling is genuinely mutual: a
//! worktree discard reports its failure as a workspace operation error, and
//! the workspace handoff manifest reads the worktree persistence tables it is
//! accounting for. They are one bounded context, so they are one crate.

pub mod workspace;
pub mod worktree;
