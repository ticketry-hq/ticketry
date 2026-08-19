#![allow(non_snake_case)]

//! The public Documents GraphQL surface.
//!
//! Reads are generated: `designDocuments` is the registered Seaography entity
//! contract, and Studio selects the fields it renders from it. Only two
//! behaviours cannot be expressed as generated model CRUD, and each is a named
//! domain operation recorded in this ticket's override record:
//!
//! * **registry refresh** observes external files and may create or prune
//!   several rows in one pass. It returns the authoritative rows so a caller
//!   converges on the reconciled registry in one round trip.
//! * **directory completion** reads no model at all. It is a trusted local
//!   read that exists so a person can choose a module folder.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use crate::entities::documents::design_document;
use crate::query_root::types::StringList;

use super::directory_completion::complete_directories;
use super::error::DocumentsError;
use super::registry_refresh::TaskRegistryScope;
use super::service::DocumentsService;

pub struct DocumentQueries;

#[CustomFields]
impl DocumentQueries {
    /// Absolute directory paths matching the trailing prefix of `path`.
    async fn directory_completions(ctx: &Context<'_>, path: String) -> Result<StringList> {
        // Completion touches no model, but it is still a workspace capability
        // Rust now owns exclusively: while the handoff gate is closed there is
        // no Django route left to answer it, so it refuses rather than serving
        // from a runtime that has not proven itself ready.
        if !crate::workspace_handoff::gate::open(ctx) {
            return Err(crate::workspace_handoff::gate::unavailable());
        }
        let completions = tokio::task::spawn_blocking(move || complete_directories(&path))
            .await
            .unwrap_or_default();
        Ok(StringList(completions))
    }
}

pub struct DocumentMutations;

#[CustomFields]
impl DocumentMutations {
    /// Reconcile one Work Item's design directories and return its documents.
    async fn refresh_task_document_registry(
        ctx: &Context<'_>,
        task_id: String,
        project_id: Option<String>,
        module_id: Option<String>,
    ) -> Result<Vec<design_document::Model>> {
        service(ctx)?
            .refresh_task(TaskRegistryScope {
                task_id,
                project_id,
                module_id,
            })
            .await
            .map_err(documents_error)
    }

    /// Reconcile one module's scratch design directories and return its
    /// planning and instant documents.
    async fn refresh_scratch_document_registry(
        ctx: &Context<'_>,
        module_id: String,
    ) -> Result<Vec<design_document::Model>> {
        service(ctx)?
            .refresh_scratch(&module_id)
            .await
            .map_err(documents_error)
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_query::<DocumentQueries>();
    builder.register_custom_mutation::<DocumentMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a DocumentsService> {
    // A registry refresh is a write: it registers files it discovered and prunes
    // rows whose file is gone. It may run only once this process holds the
    // workspace write lease and has finished its reconciliation pass.
    if !crate::workspace_handoff::gate::open(ctx) {
        return Err(crate::workspace_handoff::gate::unavailable());
    }
    ctx.data::<DocumentsService>().map_err(|_| {
        Error::new("Design documents are unavailable.")
            .extend_with(|_, extension| extension.set("code", "documents_unavailable"))
    })
}

fn documents_error(error: DocumentsError) -> Error {
    let code = error.code_str();
    let detail = error.to_string();
    Error::new("Design documents could not be listed.")
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", detail.clone()))
}
