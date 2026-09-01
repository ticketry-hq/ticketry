//! One asynchronous lock per canonical repository.
//!
//! Status-sensitive Git work for a repository is serialized so a read cannot
//! observe another operation's half-finished tree. The key is the canonical
//! repository path, so a second repository is never blocked by the first and
//! no global Git lock exists. Locks are acquired asynchronously: waiting for
//! one parks the request rather than a runtime worker.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

#[derive(Clone, Default)]
pub struct RepositoryLocks {
    locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

impl RepositoryLocks {
    pub fn new() -> Self {
        Self::default()
    }

    /// The process-wide lock set.
    ///
    /// Worktree capabilities are composed in more than one place — the GraphQL
    /// schema and the in-process MCP listener each build their own services
    /// over the same store — and the invariant is one lock per canonical
    /// repository *per process*, not per composition. Both compose through
    /// this, so a creation, an integration, and a status read can never observe
    /// one repository at the same moment. Handing out a clone keeps the map
    /// itself shared.
    pub fn shared() -> Self {
        static SHARED: std::sync::LazyLock<RepositoryLocks> =
            std::sync::LazyLock::new(RepositoryLocks::new);
        SHARED.clone()
    }

    /// Hold the lock for one canonical repository. The guard is owned, so it
    /// can be held across the awaits a Git inspection needs.
    pub async fn acquire(&self, repository: &Path) -> OwnedMutexGuard<()> {
        let key = repository.to_string_lossy().into_owned();
        let lock = {
            let mut locks = match self.locks.lock() {
                Ok(locks) => locks,
                // A poisoned map only means some other caller panicked while
                // registering a lock; the map itself is still usable.
                Err(poisoned) => poisoned.into_inner(),
            };
            Arc::clone(locks.entry(key).or_default())
        };
        lock.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn a_second_repository_is_not_blocked_by_the_first() {
        let locks = RepositoryLocks::new();
        let held = locks.acquire(&PathBuf::from("/repositories/one")).await;

        let other = tokio::time::timeout(
            Duration::from_secs(5),
            locks.acquire(&PathBuf::from("/repositories/two")),
        )
        .await;

        assert!(other.is_ok(), "an unrelated repository must stay usable");
        drop(held);
    }

    #[tokio::test]
    async fn the_same_repository_is_serialized() {
        let locks = RepositoryLocks::new();
        let repository = PathBuf::from("/repositories/one");
        let held = locks.acquire(&repository).await;

        let contended =
            tokio::time::timeout(Duration::from_millis(100), locks.acquire(&repository)).await;
        assert!(contended.is_err(), "the same repository must wait");

        drop(held);
        assert!(
            tokio::time::timeout(Duration::from_secs(5), locks.acquire(&repository))
                .await
                .is_ok(),
            "releasing the guard must hand the repository to the next caller"
        );
    }
}
