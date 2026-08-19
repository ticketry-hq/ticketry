//! The composed worktree write capabilities.
//!
//! Creating and discarding a checkout are separate capabilities with separate
//! journals, probes, and executors, but they are not independent of each
//! other: they act on the same repositories, and Git tolerates exactly one
//! writer per repository at a time. Composing them as a pair is what
//! guarantees they share one set of [`RepositoryLocks`] — and therefore that a
//! status read, a creation, and a discard in this process can never observe
//! one repository at the same moment.
//!
//! This is a composition seam, not an authority: neither service is reachable
//! through the other, and each still owns its own restricted GraphQL mutation.

use crate::worktree_create::WorktreeCreateService;
use crate::worktree_discard::WorktreeDiscardService;
use crate::worktree_status::WorktreeStatusService;

#[derive(Clone)]
pub struct WorktreeOperations {
    create: WorktreeCreateService,
    discard: WorktreeDiscardService,
}

impl WorktreeOperations {
    pub fn new(create: WorktreeCreateService, discard: WorktreeDiscardService) -> Self {
        Self { create, discard }
    }

    pub fn create(&self) -> &WorktreeCreateService {
        &self.create
    }

    pub fn discard(&self) -> &WorktreeDiscardService {
        &self.discard
    }

    /// The live-status reader both writes already share their repository locks
    /// with. Composition publishes this very instance rather than opening a
    /// second, independent set.
    pub fn status_service(&self) -> &WorktreeStatusService {
        self.create.status_service()
    }
}
