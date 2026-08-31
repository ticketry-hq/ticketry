//! The typed link between a Module and the local folder it is checked out into.
//!
//! A Module needs exactly one host-local relationship: where this machine
//! keeps its code. That relationship used to live inside `profiles.json`, as
//! one entry in a list of profiles a user selected between, which made the
//! answer depend on which profile happened to be selected, made it invisible
//! to every database read, and left it unvalidated until a launch failed.
//!
//! Here it is a row. The Module owns it — one link per Module, enforced by a
//! unique index — the identity is derived from the Module rather than minted,
//! the folder is validated for shape before it is stored, and deleting a
//! Module takes its link with it.
//!
//! The module is split by what each part decides:
//!
//! * [`schema`] installs the authored tables and refuses an unknown shape.
//! * [`local_path`] decides which folder values a row may ever hold.
//! * [`folder_preflight`] decides whether the folder on disk is usable.
//! * [`identity`] decides what a link is called, deterministically.
//! * [`store`] owns the model rules shared by host and GraphQL writes.
//! * [`resolution`] answers the one runtime question: where is this Module?
//! * [`module_link`] owns generated reads and the restricted mutation views.
//! * [`legacy_source`] decides which profile file an import may read.
//! * [`legacy_import`] performs the one-way, idempotent, reversible import.
//! * [`receipt`] is the durable artifact that makes the import reversible.
//!
//! Every entry point takes a connection its caller opened. Nothing here opens
//! a database, resolves the established data directory, or holds a default, so
//! an import can only ever reach the installation it was handed.

pub mod folder_preflight;
pub mod identity;
pub mod legacy_import;
pub mod legacy_source;
pub mod local_path;
pub mod ownership_manifest;
pub mod receipt;
pub mod resolution;
pub mod schema;
pub mod store;

mod module_link;

/// Module Link fixtures other crates' tests build against.
///
/// `#[cfg(test)]` only ever meant "this crate's own tests", and the worktree
/// tests that need these fixtures are now in another crate.
#[cfg(feature = "test-support")]
pub mod test_support;

pub use ticketry_entities::settings as entities;

mod error;

pub use error::{ModuleLinkError, ModuleLinkErrorCode};
pub use legacy_import::{import, rollback, ImportOutcome, RollbackOutcome};
pub use local_path::{LocalModulePath, LocalPathDefect};
pub use module_link::register as register_graphql;
pub use receipt::{ImportReceipt, LinkStatus, SkipReason};
pub use resolution::{ModuleFolderRefusal, FOLDER_INVALID, NOT_LINKED, STORE_UNAVAILABLE};
pub use store::{ModuleLinkRecord, ModuleLinkStore};
