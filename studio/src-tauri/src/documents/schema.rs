#![allow(non_snake_case)]

//! The public Documents GraphQL surface.
//!
//! Reads are generated: `designDocuments` is the registered Seaography entity
//! contract, and Studio selects the fields it renders from it. Directory
//! completion reads no model at all. It is a trusted local read that exists so
//! a person can choose a module folder.

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use crate::work_management::read_types::StringList;

use super::directory_completion::complete_directories;

pub struct DocumentQueries;

#[CustomFields]
impl DocumentQueries {
    /// Absolute directory paths matching the trailing prefix of `path`.
    async fn directory_completions(ctx: &Context<'_>, path: String) -> Result<StringList> {
        // Completion touches no model, but it is still a workspace capability
        // Rust now owns exclusively: while the handoff gate is closed there is
        // no Django route left to answer it, so it refuses rather than serving
        // from a runtime that has not proven itself ready.
        if !crate::workspace::handoff::gate::open(ctx) {
            return Err(crate::workspace::handoff::gate::unavailable());
        }
        let completions = tokio::task::spawn_blocking(move || complete_directories(&path))
            .await
            .unwrap_or_default();
        Ok(StringList(completions))
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_query::<DocumentQueries>();
    builder
}
