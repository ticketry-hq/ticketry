#![allow(non_snake_case)]

//! Directory completion, the one workspace read that touches no model.
//!
//! It exists so a person can choose a module folder. Documents owns the
//! filesystem walk; the gated GraphQL surface is workspace's, because the
//! readiness gate it refuses behind is.

use seaography::{
    async_graphql::{Context, Result},
    CustomFields,
};

use ticketry_entities::graphql_scalars::StringList;

use crate::documents::directory_completion::complete_directories;

pub struct DirectoryCompletionQueries;

#[CustomFields]
impl DirectoryCompletionQueries {
    /// Absolute directory paths matching the trailing prefix of `path`.
    async fn directory_completions(ctx: &Context<'_>, path: String) -> Result<StringList> {
        // Completion touches no model, but it is still a workspace capability
        // Rust now owns exclusively: while the handoff gate is closed there is
        // no Django route left to answer it, so it refuses rather than serving
        // from a runtime that has not proven itself ready.
        if !super::handoff::gate::open(ctx) {
            return Err(super::handoff::gate::unavailable());
        }
        let completions = tokio::task::spawn_blocking(move || complete_directories(&path))
            .await
            .unwrap_or_default();
        Ok(StringList(completions))
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_query::<DirectoryCompletionQueries>();
    builder
}
