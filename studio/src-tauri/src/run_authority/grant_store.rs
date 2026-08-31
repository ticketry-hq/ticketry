use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "run-authority-grants.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct StoredGrant {
    pub agent_run_id: String,
    pub allowed_tools: BTreeSet<String>,
    pub expires_at_epoch_seconds: u64,
}

#[derive(Clone)]
pub(super) struct GrantStore {
    path: PathBuf,
}

impl GrantStore {
    pub fn in_directory(data_directory: &Path) -> Self {
        Self {
            path: data_directory.join(FILE_NAME),
        }
    }

    pub fn load(&self) -> Result<HashMap<String, StoredGrant>, String> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
            Err(error) => return Err(self.failure("read", error)),
        };
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("could not decode {}: {error}", self.path.display()))
    }

    pub fn save(&self, grants: &HashMap<String, StoredGrant>) -> Result<(), String> {
        crate::settings_persistence::write_json_atomically(&self.path, grants)
            .map_err(|error| format!("could not persist {}: {error}", self.path.display()))
    }

    fn failure(&self, operation: &str, error: std::io::Error) -> String {
        format!("could not {operation} {}: {error}", self.path.display())
    }
}
