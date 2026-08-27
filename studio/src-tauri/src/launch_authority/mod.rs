//! Authoritative launch material for interactive terminal launches.
//!
//! A client may choose *what* to launch — a Work Item, a module, a registered
//! document, an agent from the picker, and its own free text. It may not
//! choose the launch policy that governs the run. This module answers the one
//! question the Terminal Launch service asks before it persists anything:
//! given those identities, which provider, model, reasoning, prompt, required
//! skills, and document identity is this launch actually allowed to run with?
//!
//! Every answer is read here, from WorkTracker launch policy, the selected
//! profile, the document registry, and the run's worktree-derived
//! directories. Nothing is echoed back from the request, so durable launch
//! material is a copy of policy rather than a copy of the caller.
//!
//! Task prompt composition also lives here so interactive launches, Run Now,
//! auto-start, retry, and Graph Run children all add the same durable Work
//! Item facts to their resolved workflow prompt.

mod error;
mod facts;
mod material;
mod service;
mod sources;
mod task_prompt;

pub use error::{LaunchAuthorityError, LaunchAuthorityErrorCode};
pub use material::ResolvedLaunchMaterial;
pub use service::{InteractiveLaunchAuthority, LaunchAuthorityService};
pub(crate) use task_prompt::{compose_task_prompt, TaskPromptSource};
