//! Landing a completed Work Item's checkout back into the base it was cut from.
//!
//! This is the one worktree capability nobody asks for. There is no "land it"
//! control and no integrate endpoint: the request is a committed transition
//! occurrence carrying a *top-level* Work Item into a completed workflow-state
//! group ([`delivery`]). A child completion names no checkout, a cancellation
//! is deliberately never landed, and re-delivering the same occurrence
//! converges on the same durable operation.
//!
//! What makes that safe is that landing is five external effects in a fixed
//! order with no transaction around them — merge the recorded base into the
//! isolated checkout, advance the base to the merged tip, remove the checkout,
//! delete the task branch, then delete the index row with its durable fact —
//! and a process can stop between any two of them. So the whole capability is
//! built around one question: *what can the repository still prove?*
//!
//! * Ancestry proves the reversible middle ([`git_evidence`]). "The base is
//!   contained in the branch" is the merge; "the branch is contained in the
//!   base" is the ref advance. A step whose proof already holds is skipped, so
//!   a second merge commit is never created and a foreign ref is never reset.
//! * A checkpoint proves the irreversible end ([`executor`]). Deleting the task
//!   branch destroys the only thing that remembered what landed, so the landed
//!   commit is recorded in the operation first. Recovery past that boundary
//!   proves the recorded base still contains that exact commit; it never
//!   concludes success from a missing branch, checkout, or row.
//! * Everything the merge cannot land stays where a person can see it. A dirty
//!   or ephemeral checkout is refused untouched, and a merge that stops leaves
//!   its conflict inside the isolated checkout — the primary checkout is never
//!   part of the merge at all.
//!
//! [`executor`] is the single performer, shared by delivery and by startup
//! reconciliation, and [`probe`] is what recovery is allowed to conclude before
//! that performer is ever invoked.

mod delivery;
mod error;
mod executor;
mod git_evidence;
mod identity;
mod plan;
mod probe;
mod service;
mod settlement;

pub use delivery::{DeliveryOutcome, IntegrationDelivery};
pub use error::{WorktreeIntegrateError, WorktreeIntegrateErrorCode};
pub use service::{WorktreeIntegrateService, MAX_DELIVERY_BATCH};
