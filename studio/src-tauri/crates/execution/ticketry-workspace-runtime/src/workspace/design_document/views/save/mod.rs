#![allow(non_snake_case)]

//! The authored `save_design_document` view.
//!
//! It is the restricted, model-shaped write seam for the Design Document
//! model: one non-null document identity, the digest the caller loaded, the
//! bytes it intends, and one non-null operation identity. A caller cannot name
//! a root, path, or directory, and every protected column stays derived. The
//! generated Design Document mutation bundle remains private.
//!
//! The response is the digest the file now holds, so the requesting window can
//! re-baseline its buffer without refetching the bytes it just sent.

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    Builder, CustomFields,
};

use crate::workspace::document_save::{
    DocumentSaveError, DocumentSaveOutcome, DocumentSaveService,
};

struct SaveDocumentView;

#[CustomFields]
impl SaveDocumentView {
    /// Replace one registered primary Markdown document with the submitted
    /// bytes, provided the file still holds `expected_digest`.
    ///
    /// `operation_id` is the caller's stable identity for this intent. Reusing
    /// it replays the durable result instead of writing a second time. A stale
    /// save returns the digest the file holds so the draft can be applied
    /// deliberately.
    async fn save_design_document(
        ctx: &Context<'_>,
        document_id: String,
        expected_digest: String,
        content: String,
        operation_id: String,
    ) -> Result<DocumentSaveOutcome> {
        service(ctx)?
            .save(&document_id, &expected_digest, content, &operation_id)
            .await
            .map_err(document_save_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_output::<DocumentSaveOutcome>();
    builder.register_custom_mutation::<SaveDocumentView>();
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a DocumentSaveService> {
    if !crate::workspace::handoff::gate::open(ctx) {
        return Err(crate::workspace::handoff::gate::unavailable());
    }
    ctx.data::<DocumentSaveService>().map_err(|_| {
        Error::new("Saving design documents is unavailable.")
            .extend_with(|_, extension| extension.set("code", "document_save_unavailable"))
    })
}

fn document_save_error(error: DocumentSaveError) -> Error {
    let code = error.code_str();
    let message = error.to_string();
    Error::new(message.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(move |_, extension| extension.set("detail", message))
}
