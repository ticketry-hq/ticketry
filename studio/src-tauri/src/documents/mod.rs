//! Discovering, authorizing, and serving design documents.
//!
//! [`crate::documents_persistence`] owns the adopted `design_documents` table
//! and its generated Seaography contract. This module owns everything the
//! filesystem side of that contract needs: the canonical design-directory
//! layout, recursive discovery, the authorization boundary every byte is read
//! through, registry reconciliation, and trusted directory completion.
//!
//! The split matters because the database and the filesystem disagree by
//! design. A row asserts a filesystem fact, so a listing reconciles rather than
//! trusts, and a read re-proves containment rather than believing a stored
//! path.

pub mod asset_access;
mod content_digest;
pub mod design_directory;
pub mod directory_completion;
pub mod document_scan;
mod error;
mod identity;
mod registry_plan;
mod registry_settlement;
mod schema;
mod service;

pub(crate) mod authorized_roots;
pub mod registry_facts;
pub mod registry_refresh;
pub mod save;

pub use asset_access::DocumentAsset;
pub use error::{DocumentsError, DocumentsErrorCode};
pub use registry_facts::{DocumentFactRecorder, DOCUMENT_CHANGED, DOCUMENT_DELETED};
pub use registry_refresh::{TaskRegistryScope, SCRATCH_TASK_ID};
pub use service::DocumentsService;

pub(crate) use authorized_roots::canonical_root;
pub(crate) use registry_settlement::RegistrationIdentity;

/// Register the authored Documents operations on the composed schema. The
/// generated `designDocuments` read contract is registered separately by
/// [`crate::documents_persistence`].
pub(crate) fn register_graphql(builder: seaography::Builder) -> seaography::Builder {
    save::register_graphql(schema::register(builder))
}
