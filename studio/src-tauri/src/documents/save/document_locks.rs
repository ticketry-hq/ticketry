//! One asynchronous lock per document identity.
//!
//! Reading the current digest, staging, and renaming must not interleave with
//! another save of the *same* document, or two writers could both find the
//! digest current and both replace the file. The key is the document identity,
//! so an unrelated document is never blocked and no global save lock exists.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

#[derive(Clone, Default)]
pub(crate) struct DocumentLocks {
    locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

impl DocumentLocks {
    /// Hold the lock for one document. The guard is owned, so it can be held
    /// across the awaits staging and settlement need.
    pub(crate) async fn acquire(&self, document_id: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let mut locks = match self.locks.lock() {
                Ok(locks) => locks,
                // A poisoned map only means some other caller panicked while
                // registering a lock; the map itself is still usable.
                Err(poisoned) => poisoned.into_inner(),
            };
            Arc::clone(locks.entry(document_id.to_owned()).or_default())
        };
        lock.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn one_document_serializes_while_another_stays_free() {
        let locks = DocumentLocks::default();
        let held = locks.acquire("doc-1").await;

        assert!(
            tokio::time::timeout(Duration::from_secs(5), locks.acquire("doc-2"))
                .await
                .is_ok(),
            "an unrelated document must stay writable"
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(100), locks.acquire("doc-1"))
                .await
                .is_err(),
            "the same document must wait"
        );

        drop(held);
        assert!(
            tokio::time::timeout(Duration::from_secs(5), locks.acquire("doc-1"))
                .await
                .is_ok(),
            "releasing the guard must hand the document to the next caller"
        );
    }
}
