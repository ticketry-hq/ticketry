use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

use super::Provider;

pub const LAUNCH_MATERIAL_VERSION: u8 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchKind {
    Task,
    Planning,
    Instant,
    DocumentChat,
    Automation,
    Resume { provider_session_id: String },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderOptions {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning: Option<String>,
}

/// Durable workspace authorization expressed only as model identities.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkspaceIdentity {
    Task {
        project_id: String,
        module_id: String,
        task_id: String,
    },
    Scratch {
        project_id: String,
        module_id: String,
        agent_run_id: String,
    },
    Document {
        project_id: String,
        module_id: String,
        document_id: String,
    },
}

/// Reproducible launch input. No executable, shell, tmux, secret, environment,
/// hook path, rendered command, concrete filesystem path, or temp path fits in
/// this schema.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DurableLaunchMaterial {
    pub version: u8,
    pub agent_run_id: String,
    pub kind: LaunchKind,
    pub provider: Provider,
    pub options: ProviderOptions,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub required_skills: Vec<String>,
    pub workspace: WorkspaceIdentity,
    #[serde(default)]
    pub document_id: Option<String>,
}

impl DurableLaunchMaterial {
    pub fn new(
        agent_run_id: impl Into<String>,
        kind: LaunchKind,
        provider: Provider,
        options: ProviderOptions,
        prompt: Option<String>,
        required_skills: Vec<String>,
        workspace: WorkspaceIdentity,
        document_id: Option<String>,
    ) -> Self {
        Self {
            version: LAUNCH_MATERIAL_VERSION,
            agent_run_id: agent_run_id.into(),
            kind,
            provider,
            options,
            prompt,
            required_skills,
            workspace,
            document_id,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeSettings {
    pub environment_name: &'static str,
    pub contents: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaterializedLaunch {
    pub argv: Vec<String>,
    pub working_directory: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub settings: Option<RuntimeSettings>,
}
