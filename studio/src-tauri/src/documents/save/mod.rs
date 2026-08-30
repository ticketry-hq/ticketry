//! Saving one registered primary Markdown document.
//!
//! A save is the second place in the Workspace Runtime where SQLite and the
//! local filesystem must agree across a gap they cannot commit across
//! together. A process can stop after the bytes were staged and before the
//! rename, after the rename and before the registry digest committed, or after
//! everything committed and before the answer reached the window that asked.
//! All three converge on one file version, one operation result, and one
//! registry digest, because a save is expressed as one Workspace Operation:
//!
//! 1. Everything is *derived* ([`target`]): the document row says which
//!    authorized root and which relative path may be written, and the same
//!    containment boundary the read path uses resolves the target. A caller
//!    submits identities and bytes, never a path.
//! 2. The operation is *prepared* before anything touches the filesystem,
//!    carrying digests and relative identities only ([`identity`]) — never the
//!    document body, which is why the staged file, not the journal, is what
//!    recovery reads the intended bytes back from.
//! 3. The bytes are staged into an operation-named file beside the target,
//!    flushed, and atomically renamed over it ([`staging`]).
//! 4. The registry digest and the durable `document.saved` fact commit inside
//!    the operation's settlement transaction ([`settlement`]), only once the
//!    rename has been proved.
//!
//! [`executor`] is the single performer of steps 3 and 4, shared by the
//! interactive path and by startup reconciliation, and [`probe`] is what
//! recovery is allowed to conclude before that performer is ever invoked.

mod document_locks;
mod error;
mod executor;
mod identity;
mod pending_bodies;
mod probe;
mod service;
mod settlement;
mod staging;
mod target;

pub use error::{DocumentSaveError, DocumentSaveErrorCode};
pub use service::{DocumentSaveOutcome, DocumentSaveService};
pub use staging::{staging_file_name, STAGING_PREFIX};
