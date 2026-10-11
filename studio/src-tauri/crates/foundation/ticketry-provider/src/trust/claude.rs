use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::{Map, Value};

use super::{
    DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, ProviderFailure,
};
use crate::{
    claude_state::{read_state, state_file, write_state, DirectoryLock},
    Provider,
};

// Oldest release verified to persist trust as `projects[key].hasTrustDialogAccepted`.
// Later 2.x releases keep that format; a major bump must be re-verified.
const MINIMUM_VERSION: (u64, u64, u64) = (2, 1, 270);

pub(super) fn inspect(context: DirectoryTrustContext<'_>) -> DirectoryTrustInspection {
    if context.trust_file.is_none() {
        if let Err(error) = validate_version(context.executable) {
            return DirectoryTrustInspection::Failed(ProviderFailure {
                message: error.to_string(),
            });
        }
    }
    inspect_inner(context).unwrap_or_else(|error| {
        DirectoryTrustInspection::Failed(ProviderFailure {
            message: error.to_string(),
        })
    })
}

pub(super) fn prepare(
    context: DirectoryTrustContext<'_>,
    approval: Option<&DirectoryTrustApproval>,
) -> DirectoryTrustPreparation {
    if context.trust_file.is_none() {
        if let Err(error) = validate_version(context.executable) {
            return DirectoryTrustPreparation::Failed(ProviderFailure {
                message: error.to_string(),
            });
        }
    }
    prepare_inner(context, approval).unwrap_or_else(|error| {
        DirectoryTrustPreparation::Failed(ProviderFailure {
            message: error.to_string(),
        })
    })
}

fn validate_version(executable: Option<&Path>) -> io::Result<()> {
    let output = Command::new(executable.unwrap_or_else(|| Path::new("claude")))
        .arg("--version")
        .output()
        .map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("Could not inspect Claude Code version: {error}"),
            )
        })?;
    let version = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or("unknown")
        .to_owned();
    if !output.status.success() || !is_supported(&version) {
        let (major, minor, patch) = MINIMUM_VERSION;
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!(
                "Claude Code {version} does not have a verified durable trust adapter; expected {major}.x at or above {major}.{minor}.{patch}."
            ),
        ));
    }
    Ok(())
}

fn is_supported(version: &str) -> bool {
    let mut parts = version.split('.').map(str::parse::<u64>);
    let (Some(Ok(major)), Some(Ok(minor)), Some(Ok(patch)), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    major == MINIMUM_VERSION.0 && (major, minor, patch) >= MINIMUM_VERSION
}

fn inspect_inner(context: DirectoryTrustContext<'_>) -> io::Result<DirectoryTrustInspection> {
    let (directory, config) = validated_paths(context)?;
    let state = read_state(&config)?.1;
    let provider_key = persisted_trust_key(&directory);
    Ok(match trust(&state, &provider_key)? {
        Some(true) => DirectoryTrustInspection::Trusted,
        Some(false) | None => DirectoryTrustInspection::ApprovalRequired(DirectoryTrustApproval {
            provider: Provider::Claude,
            directory,
            trust_file: config,
            provider_key: Some(provider_key),
        }),
    })
}

fn prepare_inner(
    context: DirectoryTrustContext<'_>,
    approval: Option<&DirectoryTrustApproval>,
) -> io::Result<DirectoryTrustPreparation> {
    let (directory, config) = validated_paths(context)?;
    let provider_key = persisted_trust_key(&directory);
    let state = read_state(&config)?.1;
    match trust(&state, &provider_key)? {
        Some(true) => return Ok(DirectoryTrustPreparation::AlreadyTrusted),
        Some(false) | None => {}
    }
    if approval.is_none_or(|approval| {
        approval.provider != Provider::Claude
            || approval.directory != directory
            || approval.trust_file != config
            || approval.provider_key.as_deref() != Some(provider_key.as_path())
    }) {
        return Ok(DirectoryTrustPreparation::ApprovalRequired);
    }

    let parent = config.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Claude state requires a parent directory.",
        )
    })?;
    fs::create_dir_all(parent)?;
    let lock = DirectoryLock::acquire(&config)?;
    let (before, mut state) = read_state(&config)?;
    match trust(&state, &provider_key)? {
        Some(true) => return Ok(DirectoryTrustPreparation::AlreadyTrusted),
        Some(false) | None => {}
    }

    let key = provider_key.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Claude project paths must be UTF-8.",
        )
    })?;
    let root = state.as_object_mut().unwrap();
    if !root.contains_key("projects") {
        root.insert("projects".into(), Value::Object(Map::new()));
    }
    let projects = root["projects"].as_object_mut().unwrap();
    if !projects.contains_key(key) {
        projects.insert(key.into(), Value::Object(Map::new()));
    }
    projects[key]
        .as_object_mut()
        .unwrap()
        .insert("hasTrustDialogAccepted".into(), Value::Bool(true));
    let contents = serde_json::to_vec_pretty(&state)?;
    write_state(&config, &before, &contents)?;
    drop(lock);
    Ok(DirectoryTrustPreparation::Prepared)
}

fn validated_paths(context: DirectoryTrustContext<'_>) -> io::Result<(PathBuf, PathBuf)> {
    if !context.directory.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Claude trust requires an absolute directory path.",
        ));
    }
    let directory = context.directory.canonicalize()?;
    if !directory.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Claude trust requires an existing directory.",
        ));
    }
    if std::env::home_dir()
        .and_then(|home| home.canonicalize().ok())
        .is_some_and(|home| home == directory)
    {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Claude cannot persist trust for the home directory; select a project subdirectory.",
        ));
    }
    Ok((directory, state_file(context.trust_file)?))
}

fn trust(state: &Value, provider_key: &Path) -> io::Result<Option<bool>> {
    let Some(projects) = state.get("projects").and_then(Value::as_object) else {
        return Ok(None);
    };
    let key = provider_key.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Claude project paths must be UTF-8.",
        )
    })?;
    Ok(projects
        .get(key)
        .and_then(|project| project.get("hasTrustDialogAccepted"))
        .and_then(Value::as_bool))
}

fn persisted_trust_key(directory: &Path) -> PathBuf {
    directory
        .ancestors()
        .find(|ancestor| ancestor.join(".git").exists())
        .unwrap_or(directory)
        .to_path_buf()
}
