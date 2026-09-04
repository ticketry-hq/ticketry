use seaography::async_graphql::{Context, Error, ErrorExtensions, Result};

use ticketry_documents::{DocumentsError, DocumentsService};

pub(super) fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a DocumentsService> {
    // Registry refresh writes discovered rows and prunes missing files. It may
    // run only after this process owns the workspace and reconciliation ended.
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
    }
    ctx.data::<DocumentsService>().map_err(|_| {
        Error::new("Design documents are unavailable.")
            .extend_with(|_, extension| extension.set("code", "documents_unavailable"))
    })
}

pub(super) fn documents_error(error: DocumentsError) -> Error {
    let code = error.code_str();
    let detail = error.to_string();
    Error::new("Design documents could not be listed.")
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", detail.clone()))
}
