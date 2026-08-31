//! What commits once the rename has been proved.
//!
//! The registry digest and the durable document fact are written inside the
//! Workspace Operation's own settlement transaction, so the three either all
//! exist or none do. Bookkeeping can therefore never get ahead of the file:
//! the digest is recorded only after the primary document is provably the
//! intended version, and the fact is appended only with it.
//!
//! A save publishes through the same seam discovery publishes through, so a
//! consumer sees one `document.changed` family whether the bytes arrived from
//! Studio's editor or from an agent writing the file directly. Settling twice
//! writes nothing twice: the journal turns a repeated acknowledgement of the
//! same outcome into a no-op, which is what keeps a retried or reconciled save
//! from appending a second fact.

use chrono::{SecondsFormat, Utc};
use sea_orm::{sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter};
use serde_json::{json, Value};

use ticketry_documents::registry_facts::{self, DocumentChange, DocumentFactRecorder};
use ticketry_entities::documents::design_document;

use super::error::{DocumentSaveError, DocumentSaveErrorCode};
use super::identity::SaveIntent;
use super::target::SaveTarget;

/// The durable, replayable result a later request reusing the identity gets
/// back. It names relative identities and digests only.
pub(crate) fn result(save: &SaveIntent) -> Value {
    json!({
        "documentId": save.document_id,
        "relPath": save.rel_path,
        "digest": save.intended_digest,
        "byteLength": save.byte_length,
    })
}

/// Record the digest the primary file now holds and publish the change.
///
/// Runs inside the settlement transaction; a failure aborts it and leaves the
/// operation unsettled. `Ok(true)` means a fact was appended and live
/// subscribers should be woken once the transaction commits.
pub(crate) async fn commit(
    transaction: &DatabaseTransaction,
    facts: Option<&DocumentFactRecorder>,
    target: &SaveTarget,
    digest: &str,
) -> Result<bool, DocumentSaveError> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false);
    design_document::Entity::update_many()
        .filter(design_document::Column::Id.eq(target.row.id.clone()))
        .col_expr(design_document::Column::ContentDigest, Expr::value(digest))
        .col_expr(design_document::Column::UpdatedAt, Expr::value(now.clone()))
        .exec(transaction)
        .await
        .map_err(|_| {
            DocumentSaveError::new(
                DocumentSaveErrorCode::Storage,
                "The document digest could not be recorded.",
            )
        })?;

    if facts.is_none() {
        return Ok(false);
    }
    // The row as it now stands, so the published fact describes what committed
    // rather than what the save started from.
    let row = design_document::Model {
        content_digest: Some(digest.to_owned()),
        updated_at: now,
        ..target.row.clone()
    };
    // A document whose owning Work Item or module cannot be resolved publishes
    // nothing rather than a fact aimed at a guessed project.
    let Some(owner) = registry_facts::resolve_owner(transaction, &row).await? else {
        return Ok(false);
    };
    registry_facts::record_document(facts, transaction, &owner, &row, DocumentChange::Changed)
        .await?;
    Ok(true)
}
