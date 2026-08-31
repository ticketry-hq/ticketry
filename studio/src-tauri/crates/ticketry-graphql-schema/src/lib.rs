//! The assembled GraphQL surface: one schema built out of every slice.
//!
//! Every other slice registers its own entities, views, and commands. This
//! crate is where those registrations are collected into the single schema the
//! desktop shell and the MCP listener serve, and where the database behind it
//! is adopted, migrated, and gated on readiness before the first query runs.
//!
//! [`query_root`] defines the schema — the query and mutation roots, the
//! Seaography builder, and the request context every resolver reads.
//! [`graphql_foundation`] assembles it — installation, migrations, entity
//! registration, the composed command runtime, and the Tauri transport the
//! frontend talks to.

pub mod graphql_foundation;
pub mod query_root;
