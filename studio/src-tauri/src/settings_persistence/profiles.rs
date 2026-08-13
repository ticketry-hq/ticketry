use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::atomic_json::{write_json, AtomicFileOperations, RealAtomicFileOperations};
use super::SettingsPersistenceError;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ModuleLink {
    pub module_id: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub workspace_slug: String,
    #[serde(default)]
    pub agent_prompt: Option<String>,
    #[serde(default)]
    pub agent_prompts: BTreeMap<String, Value>,
    #[serde(default)]
    pub module_links: Vec<ModuleLink>,
    #[serde(default)]
    pub recent_project_id: Option<String>,
    #[serde(default)]
    pub recent_module_ids: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ProfileCatalog {
    pub recent_profile_index: Option<i32>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

#[derive(Clone)]
pub struct ProfileStore {
    path: PathBuf,
    mutation_lock: Arc<Mutex<()>>,
    operations: Arc<dyn AtomicFileOperations>,
}

impl ProfileStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_owned(),
            mutation_lock: Arc::new(Mutex::new(())),
            operations: Arc::new(RealAtomicFileOperations),
        }
    }

    /// Match Django's established safe read fallback without repairing disk.
    pub fn read(&self) -> ProfileCatalog {
        read_catalog(&self.path).unwrap_or_default()
    }

    pub fn replace(&self, catalog: &ProfileCatalog) -> Result<(), SettingsPersistenceError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| SettingsPersistenceError::ConcurrentAccess)?;
        if self.path.exists() {
            read_catalog(&self.path)?;
        }
        write_json(&self.path, catalog, self.operations.as_ref())
    }

    /// Reload-under-lock prevents concurrent callers from losing an update.
    pub fn update(
        &self,
        mutation: impl FnOnce(&mut ProfileCatalog) -> Result<(), SettingsPersistenceError>,
    ) -> Result<ProfileCatalog, SettingsPersistenceError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| SettingsPersistenceError::ConcurrentAccess)?;
        let mut catalog = if self.path.exists() {
            read_catalog(&self.path)?
        } else {
            ProfileCatalog::default()
        };
        mutation(&mut catalog)?;
        write_json(&self.path, &catalog, self.operations.as_ref())?;
        Ok(catalog)
    }

    pub fn add(&self, profile: Profile) -> Result<ProfileCatalog, SettingsPersistenceError> {
        self.update(|catalog| {
            catalog.profiles.push(profile);
            Ok(())
        })
    }

    pub fn replace_at(
        &self,
        index: i32,
        profile: Profile,
    ) -> Result<ProfileCatalog, SettingsPersistenceError> {
        self.update(|catalog| {
            let index = require_index(catalog, index)?;
            catalog.profiles[index] = profile;
            Ok(())
        })
    }

    pub fn delete_at(&self, index: i32) -> Result<ProfileCatalog, SettingsPersistenceError> {
        self.update(|catalog| {
            let position = require_index(catalog, index)?;
            catalog.profiles.remove(position);
            match catalog.recent_profile_index {
                Some(recent) if recent == index => {
                    catalog.recent_profile_index = (!catalog.profiles.is_empty()).then_some(0);
                }
                Some(recent) if recent > index => {
                    catalog.recent_profile_index = Some(recent - 1);
                }
                _ => {}
            }
            Ok(())
        })
    }

    pub fn select(&self, index: i32) -> Result<ProfileCatalog, SettingsPersistenceError> {
        self.update(|catalog| {
            require_index(catalog, index)?;
            catalog.recent_profile_index = Some(index);
            Ok(())
        })
    }
}

fn require_index(catalog: &ProfileCatalog, index: i32) -> Result<usize, SettingsPersistenceError> {
    let index = usize::try_from(index).map_err(|_| SettingsPersistenceError::IndexOutOfRange)?;
    if index >= catalog.profiles.len() {
        return Err(SettingsPersistenceError::IndexOutOfRange);
    }
    Ok(index)
}

fn read_catalog(path: &Path) -> Result<ProfileCatalog, SettingsPersistenceError> {
    let bytes = fs::read(path).map_err(|error| SettingsPersistenceError::io(path, error))?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| corrupt(path))?;
    normalize_catalog(value, path)
}

pub(crate) fn validate_file(path: &Path) -> Result<(), SettingsPersistenceError> {
    read_catalog(path).map(drop)
}

fn normalize_catalog(
    mut value: Value,
    path: &Path,
) -> Result<ProfileCatalog, SettingsPersistenceError> {
    let object = value.as_object_mut().ok_or_else(|| corrupt(path))?;
    if !object.contains_key("profiles") {
        object.insert("profiles".to_owned(), Value::Array(Vec::new()));
    }
    let profiles = object
        .get_mut("profiles")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| corrupt(path))?;
    for profile in profiles {
        let profile = profile.as_object_mut().ok_or_else(|| corrupt(path))?;
        if !profile.contains_key("module_links") {
            if let Some(folders) = profile.get("module_folders").and_then(Value::as_object) {
                let mut links = Vec::with_capacity(folders.len());
                for (module_id, folder) in folders {
                    let folder = folder.as_str().ok_or_else(|| corrupt(path))?;
                    links.push(serde_json::json!({
                        "module_id": module_id,
                        "path": folder,
                    }));
                }
                profile.insert("module_links".to_owned(), Value::Array(links));
            }
        }
        profile.remove("module_folders");
        retain_profile_fields(profile);
    }
    object.retain(|key, _| matches!(key.as_str(), "recent_profile_index" | "profiles"));
    serde_json::from_value(value).map_err(|_| corrupt(path))
}

fn retain_profile_fields(profile: &mut Map<String, Value>) {
    profile.retain(|key, _| {
        matches!(
            key.as_str(),
            "name"
                | "workspace_slug"
                | "agent_prompt"
                | "agent_prompts"
                | "module_links"
                | "recent_project_id"
                | "recent_module_ids"
        )
    });
}

fn corrupt(path: &Path) -> SettingsPersistenceError {
    SettingsPersistenceError::CorruptJson {
        path: path.to_owned(),
    }
}
