//! The last Slice 2 readiness result this process wrote to the data
//! directory. The supervisor monitor polls four times a second; the readiness
//! file is a transition record, so it is rewritten only when the computed
//! result actually differs from what is already published.

use std::path::Path;
use std::sync::Mutex;

use crate::settings_persistence::{self, SettingsPersistenceError, Slice2Readiness};

pub(crate) struct ReadinessPublication {
    last_published: Mutex<Option<Slice2Readiness>>,
}

impl ReadinessPublication {
    pub(crate) fn new() -> Self {
        Self {
            last_published: Mutex::new(None),
        }
    }

    /// Remember a result published outside this cache. Startup, backend launch
    /// and shutdown write the gate unconditionally at their genuine
    /// transitions; recording keeps the next comparison honest.
    pub(crate) fn record(&self, readiness: &Slice2Readiness) {
        *self
            .last_published
            .lock()
            .expect("readiness publication lock poisoned") = Some(readiness.clone());
    }

    /// Write the readiness file only when the result differs from the last one
    /// this process published. Returns whether the file was rewritten.
    pub(crate) fn publish_if_changed(
        &self,
        data_directory: &Path,
        readiness: &Slice2Readiness,
    ) -> Result<bool, SettingsPersistenceError> {
        let mut last_published = self
            .last_published
            .lock()
            .expect("readiness publication lock poisoned");
        if last_published.as_ref() == Some(readiness) {
            return Ok(false);
        }
        settings_persistence::publish_readiness(data_directory, readiness)?;
        *last_published = Some(readiness.clone());
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn readiness_file(directory: &Path) -> std::path::PathBuf {
        directory.join("slice2-readiness.json")
    }

    #[test]
    fn an_unchanged_result_is_not_rewritten() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let publication = ReadinessPublication::new();

        assert!(publication
            .publish_if_changed(directory.path(), &Slice2Readiness::complete())
            .expect("publish complete readiness"));
        std::fs::remove_file(readiness_file(directory.path())).expect("remove readiness file");

        assert!(!publication
            .publish_if_changed(directory.path(), &Slice2Readiness::complete())
            .expect("skip an unchanged readiness result"));
        assert!(!readiness_file(directory.path()).exists());
    }

    #[test]
    fn a_changed_result_is_published() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let publication = ReadinessPublication::new();

        publication
            .publish_if_changed(directory.path(), &Slice2Readiness::unavailable())
            .expect("publish unavailable readiness");
        assert!(publication
            .publish_if_changed(directory.path(), &Slice2Readiness::complete())
            .expect("publish complete readiness"));
        assert!(settings_persistence::published_readiness_is_complete(
            directory.path()
        ));
    }

    #[test]
    fn a_recorded_transition_suppresses_the_next_identical_publish() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let publication = ReadinessPublication::new();

        publication.record(&Slice2Readiness::complete());

        assert!(!publication
            .publish_if_changed(directory.path(), &Slice2Readiness::complete())
            .expect("skip a result already published at a transition"));
        assert!(!readiness_file(directory.path()).exists());
    }

    #[test]
    fn an_invalid_result_is_reported_and_not_remembered() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        let publication = ReadinessPublication::new();
        let mut partial = Slice2Readiness::complete();
        partial.rust_mcp = false;

        assert!(publication
            .publish_if_changed(directory.path(), &partial)
            .is_err());
        assert!(publication
            .publish_if_changed(directory.path(), &Slice2Readiness::complete())
            .expect("publish complete readiness"));
    }
}
