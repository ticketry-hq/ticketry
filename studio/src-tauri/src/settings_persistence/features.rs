use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::atomic_json::{write_json, AtomicFileOperations, RealAtomicFileOperations};
use super::SettingsPersistenceError;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FeatureFlags {
    pub sidebar: bool,
    pub projects: bool,
}

impl FeatureFlags {
    pub(crate) fn normalize(mut self) -> Self {
        if !self.sidebar {
            self.projects = false;
        }
        self
    }
}

#[derive(Clone)]
pub struct FeatureStore {
    path: PathBuf,
    mutation_lock: Arc<Mutex<()>>,
    operations: Arc<dyn AtomicFileOperations>,
}

impl FeatureStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_owned(),
            mutation_lock: Arc::new(Mutex::new(())),
            operations: Arc::new(RealAtomicFileOperations),
        }
    }

    pub fn read(&self) -> FeatureFlags {
        read_flags(&self.path).unwrap_or_default()
    }

    pub fn replace(&self, flags: FeatureFlags) -> Result<FeatureFlags, SettingsPersistenceError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| SettingsPersistenceError::ConcurrentAccess)?;
        if self.path.exists() {
            read_flags(&self.path)?;
        }
        let flags = flags.normalize();
        write_json(&self.path, &flags, self.operations.as_ref())?;
        Ok(flags)
    }
}

fn read_flags(path: &Path) -> Result<FeatureFlags, SettingsPersistenceError> {
    let bytes = fs::read(path).map_err(|error| SettingsPersistenceError::io(path, error))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| corrupt(path))?;
    let object = value.as_object().ok_or_else(|| corrupt(path))?;
    let sidebar = object
        .get("sidebar")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let projects = object
        .get("projects")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    Ok(FeatureFlags { sidebar, projects }.normalize())
}

pub(crate) fn validate_file(path: &Path) -> Result<(), SettingsPersistenceError> {
    read_flags(path).map(drop)
}

fn corrupt(path: &Path) -> SettingsPersistenceError {
    SettingsPersistenceError::CorruptJson {
        path: path.to_owned(),
    }
}
