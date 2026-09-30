#![deny(private_bounds, private_interfaces)]

//! Design documents: discovering them, authorizing them, and serving them.
//!
//! A design document is a Markdown file on disk that the product also tracks
//! as a row. The private `persistence` implementation owns the adopted
//! `design_documents` table and its generated Seaography contract; the rest of
//! this crate owns everything the
//! filesystem side of that contract needs: the canonical design-directory
//! layout, recursive discovery, the authorization boundary every byte is read
//! through, registry reconciliation, and trusted directory completion.
//!
//! The split matters because the database and the filesystem disagree by
//! design. A row asserts a filesystem fact, so a listing reconciles rather than
//! trusts, and a read re-proves containment rather than believing a stored
//! path.

mod asset_access;
mod content_digest;
mod design_directory;
mod directory_completion;
mod document_scan;
mod error;
mod identity;
mod persistence;
mod registry_plan;
mod registry_settlement;
mod service;
mod watch;

mod authorized_roots;
mod registry_facts;
mod registry_refresh;

pub use asset_access::{
    digest, media_type, read_asset, resolve_asset, DocumentAsset, MARKDOWN_MEDIA_TYPE,
};
pub use authorized_roots::canonical_root;
pub use design_directory::{
    module_dir_name, planning_design_dir, resolve_task_design_dir, slugify, task_design_dir,
    task_dir_name, ModuleIdentity, TaskIdentity, PLANNING_SUBDIR, SPEC_ROOT,
};
pub use directory_completion::complete_directories;
pub use document_scan::{is_document_path, scan_documents, DOCUMENT_EXTENSIONS};
pub use error::{DocumentsError, DocumentsErrorCode};
pub use persistence::{
    adopt, apply_column_policy, documents_adopted, preflight, register_graphql, AdoptionEvidence,
    DocumentsPersistenceError, DocumentsPersistenceErrorCode, SourceClassification,
    AUTHORED_TABLES, CURRENT_DJANGO_LEAF, DOCUMENT_SCHEMA_VERSION, LEDGER_TABLE,
};
pub use persistence::{
    document_owned_tables, DOCUMENT_DESIGN_COLUMNS, DOCUMENT_INTERNAL_ONLY_COLUMNS,
    DOCUMENT_OWNED_TABLES, DOCUMENT_OWNERSHIP_VERSION, DOCUMENT_PROTECTED_COLUMNS,
    GENERATED_MUTATION_FINDINGS,
};
pub use registry_facts::{
    record_document_change, DocumentChange, DocumentFactRecorder, DOCUMENT_CHANGED,
    DOCUMENT_DELETED,
};
pub use registry_refresh::{
    list_for_scratch, list_for_task, refresh_scratch, refresh_task, rescan_root, settle_paths,
    TaskRegistryScope, SCRATCH_TASK_ID,
};
pub use registry_settlement::RegistrationIdentity;
pub use service::DocumentsService;
pub use watch::{
    DirectoryWatch, DocumentWatchSupervisor, FilesystemEvent, FilesystemWatcher, NotifyWatcher,
    WatchUnavailable,
};
