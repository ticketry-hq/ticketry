//! The durable facts a worktree change publishes.
//!
//! Every worktree settlement — creation, an integration conflict, a discard,
//! an integration, and the reconciliation that finishes any of them after a
//! restart — changes exactly one thing a person can see: the checkout one
//! top-level Work Item holds. This module is the single seam those settlements
//! publish that change through, so the vocabulary, the payload version, and
//! the scoping rules cannot drift between them.
//!
//! Two rules make the facts safe to act on:
//!
//! * **Scope is resolved, never submitted.** A settlement knows a row and a
//!   Work Item identity; it does not know which project the checkout belongs
//!   to, and a caller's idea of "the current project" is not evidence. The
//!   authoritative project and the authoritative top-level owner are read back
//!   out of the Work Item graph ([`scope`]) before anything is published. A
//!   scope that cannot be resolved publishes nothing, because a fact aimed at a
//!   guessed project would either miss the consumer that needs it or refresh a
//!   workspace the change never touched.
//! * **A fact is a domain fact, not a cache instruction.** It names the
//!   checkout, its owning top-level Work Item, and what happened to it
//!   ([`publish`]). Which holding a consumer refetches because of that stays
//!   the consumer's decision, and no local path is ever published — the
//!   authoritative status query serves that.
//!
//! Publication happens inside the settlement's own transaction, so a
//! rolled-back settlement publishes nothing and a committed one is replayable
//! at its cursor.

mod publish;
mod scope;

pub use publish::{
    record_worktree, WorktreeChange, WorktreeFact, PAYLOAD_VERSION, WORKTREE_CHANGED,
    WORKTREE_DELETED,
};
pub use scope::{resolve as resolve_scope, WorktreeFactScope};
