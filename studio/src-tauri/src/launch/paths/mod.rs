//! Where one agent run is allowed to start: its working directory and its
//! design directory.
//!
//! This is the temporary compatibility boundary the still-Python terminal
//! capability launches through, and it exists because Documents and Worktrees
//! moved to Rust while terminal spawning did not. Python used to read the
//! `worktrees` and `design_documents` tables itself and to create design
//! directories on disk; after the handoff it may do neither, so it asks this
//! module the one question a launch actually needs answered.
//!
//! The shape of that question is the whole safety argument:
//!
//! * **The caller submits identities, never places.** A request carries a run
//!   scope, an Agent Run identity, a project, a module, and — for a task
//!   launch — a Work Item. There is no path, branch, ref, Git argument,
//!   document body, or model field anywhere in it, so there is nothing for a
//!   caller to aim.
//! * **Every directory is derived here.** Ownership comes from the Work Item
//!   graph, the checkout comes from the worktree index, the folder comes from
//!   the selected profile, and the design directory comes from the canonical
//!   layout contract. A caller cannot widen any of them.
//! * **Nothing is created, saved, pruned, discarded, or integrated.** The one
//!   filesystem effect is materializing the derived design directory the run
//!   is about to write into, which is the same directory discovery already
//!   authorizes. No worktree, branch, document row, or file body is written.
//!
//! Launch stays *use-if-exists*: an active or conflict worktree owned by the
//! top-level Work Item roots the run, a missing or stale one falls back to the
//! module folder, and planning and instant runs keep their run-scoped design
//! directories without ever minting a worktree.

mod error;
mod folder_preflight;
mod request;
mod service;
mod view;

pub use error::{LaunchPathsError, LaunchPathsErrorCode};
pub(crate) use folder_preflight::{
    validate_configured as validate_module_folder, ModuleFolderFailure,
};
pub use request::{LaunchPathsRequest, LaunchScope};
pub use service::LaunchPathsService;
pub use view::{LaunchPathsView, WorktreeUse};
