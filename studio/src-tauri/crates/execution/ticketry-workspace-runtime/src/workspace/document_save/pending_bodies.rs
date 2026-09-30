//! The intended bytes of saves this process is still performing.
//!
//! The journal refuses to persist a document body, so the durable record of
//! what a save intends is the staged file, not the row. Between preparing an
//! operation and staging it there is a moment where the bytes exist only in
//! the request that carried them — this is where they wait, keyed by the
//! operation identity that will name their staged file.
//!
//! Nothing here survives a restart, and nothing is meant to: a reconciler
//! finds an intact staged file or concludes the save never reached the disk.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct PendingBodies {
    bodies: Arc<Mutex<HashMap<String, Arc<Vec<u8>>>>>,
}

impl PendingBodies {
    pub fn hold(&self, operation_id: &str, bytes: Arc<Vec<u8>>) {
        self.entries().insert(operation_id.to_owned(), bytes);
    }

    pub fn get(&self, operation_id: &str) -> Option<Arc<Vec<u8>>> {
        self.entries().get(operation_id).cloned()
    }

    pub fn release(&self, operation_id: &str) {
        self.entries().remove(operation_id);
    }

    fn entries(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Vec<u8>>>> {
        match self.bodies.lock() {
            Ok(entries) => entries,
            // A poisoned map only means some other caller panicked while
            // holding bytes; the map itself is still usable.
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_are_held_only_until_their_operation_releases_them() {
        let bodies = PendingBodies::default();
        bodies.hold("op-1", Arc::new(b"# draft".to_vec()));

        assert_eq!(bodies.get("op-1").as_deref(), Some(&b"# draft".to_vec()));
        assert!(bodies.get("op-2").is_none());

        bodies.release("op-1");
        assert!(bodies.get("op-1").is_none());
    }
}
