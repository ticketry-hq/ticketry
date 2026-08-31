//! The two pre-Rust configuration files, read but never written.
//!
//! `profiles.json` and `features.json` are historical: a Module's folder is now
//! its own typed `module_link` row, and this version ships one
//! installation project with no feature gates. Both files survive only so
//! settings adoption can classify what a previous install left behind and the
//! Module Link importer can adopt the links recorded inside.
//!
//! Nothing here mutates either file. There is no live profile catalog, no
//! profile selection, and no feature-flag store to write through.

use std::fs;
use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::SettingsPersistenceError;

/// One `module_links` entry as a legacy profile recorded it.
#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
pub struct ModuleLink {
    pub module_id: String,
    pub path: String,
}

/// One legacy profile. Only the fields the Module Link importer reads are
/// modelled; everything else a historical file carried is dropped on read.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Profile {
    pub name: String,
    pub workspace_slug: String,
    #[serde(default)]
    pub module_links: Vec<ModuleLink>,
}

/// A legacy `profiles.json` as read from disk.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct ProfileCatalog {
    pub recent_profile_index: Option<i32>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

/// Read one legacy profile file, refusing rather than repairing a malformed one.
///
/// The historical `module_folders` spelling is normalized to `module_links` so
/// the importer sees one shape regardless of which release wrote the file.
pub fn read_profile_file(path: &Path) -> Result<ProfileCatalog, SettingsPersistenceError> {
    let bytes = fs::read(path).map_err(|error| SettingsPersistenceError::io(path, error))?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| corrupt(path))?;
    normalize_catalog(value, path)
}

/// Whether a `profiles.json` beside an adopted store is readable configuration.
pub fn validate_profile_file(path: &Path) -> Result<(), SettingsPersistenceError> {
    read_profile_file(path).map(drop)
}

/// Whether a `features.json` beside an adopted store is readable configuration.
///
/// The flags themselves are inert in this version, so the check confirms only
/// that the file is a JSON object rather than something else left in the data
/// directory under that name.
pub fn validate_feature_file(path: &Path) -> Result<(), SettingsPersistenceError> {
    let bytes = fs::read(path).map_err(|error| SettingsPersistenceError::io(path, error))?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| corrupt(path))?;
    value.as_object().ok_or_else(|| corrupt(path)).map(drop)
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
    profile.retain(|key, _| matches!(key.as_str(), "name" | "workspace_slug" | "module_links"));
}

fn corrupt(path: &Path) -> SettingsPersistenceError {
    SettingsPersistenceError::CorruptJson {
        path: path.to_owned(),
    }
}
