//! Design documents: discovering them, authorizing them, and serving them.
//!
//! A design document is a Markdown file on disk that the product also tracks
//! as a row. [`persistence`] owns the adopted `design_documents` table and its
//! generated Seaography contract; the rest of this crate owns everything the
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
pub mod persistence;
mod registry_plan;
mod registry_settlement;
mod service;
pub mod watch;

pub mod authorized_roots;
pub mod registry_facts;
pub mod registry_refresh;

pub use asset_access::DocumentAsset;
pub use error::{DocumentsError, DocumentsErrorCode};
pub use registry_facts::{DocumentFactRecorder, DOCUMENT_CHANGED, DOCUMENT_DELETED};
pub use registry_refresh::{TaskRegistryScope, SCRATCH_TASK_ID};
pub use service::DocumentsService;

pub use authorized_roots::canonical_root;
pub use registry_settlement::RegistrationIdentity;
