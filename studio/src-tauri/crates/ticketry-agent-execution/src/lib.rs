//! Running a dependency graph of Work Items as one campaign of agent runs.
//!
//! Everything below this crate decides what a run may be; this crate is where
//! runs actually get driven. [`execution`] holds the campaign machinery: its
//! `graph` reads the durable facts that say which Work Items are ready,
//! blocked or already satisfied; its `persistence` is the graph-run tables and
//! the adoption evidence that lets a restarted process pick a campaign back up;
//! its `run_now` is the single-Work-Item press; its `reconciliation` is the
//! background loop that presses the graph forward as facts change; and
//! `launch_delivery` and `merge_preparation_launcher` are the two seams where a
//! decided launch becomes a real terminal session.
//!
//! [`graph_run_service`] is the serialized front door onto that machinery — one
//! campaign, one claim at a time — offering create, manual press, reset and
//! delete, plus the read scope the assembled GraphQL schema installs so callers
//! see only the campaigns they own.

pub mod execution;
pub mod graph_run_service;
