use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::{Map, Value};

use super::{
    DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, ProviderFailure,
};
use crate::Provider;

const SUPPORTED_VERSIONS: &[&str] = &["2.1.270", "2.1.276", "2.1.278"];

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
    if !output.status.success() || !SUPPORTED_VERSIONS.contains(&version.as_str()) {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!(
                "Claude Code {version} does not have a verified durable trust adapter; expected one of {}.",
                SUPPORTED_VERSIONS.join(", ")
            ),
        ));
    }
    Ok(())
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

fn state_file(configured: Option<&Path>) -> io::Result<PathBuf> {
    let file = if let Some(configured) = configured {
        configured.to_path_buf()
    } else if let Some(config) =
        std::env::var_os("CLAUDE_CONFIG_DIR").filter(|value| !value.is_empty())
    {
        PathBuf::from(config).join(".claude.json")
    } else {
        std::env::home_dir()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Cannot determine Claude's home directory.",
                )
            })?
            .join(".claude.json")
    };
    if !file.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Claude configuration paths must be absolute.",
        ));
    }
    Ok(file)
}

fn read_state(file: &Path) -> io::Result<(Vec<u8>, Value)> {
    if let Ok(metadata) = fs::symlink_metadata(file) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Claude state must be a regular, non-symlinked file.",
            ));
        }
    }
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => b"{}".to_vec(),
        Err(error) => return Err(error),
    };
    let state: Value = serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if !state.is_object() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Claude application state must be a JSON object.",
        ));
    }
    validate_projects(&state)?;
    Ok((
        if bytes == b"{}" && !file.exists() {
            Vec::new()
        } else {
            bytes
        },
        state,
    ))
}

fn validate_projects(state: &Value) -> io::Result<()> {
    let Some(projects) = state.get("projects") else {
        return Ok(());
    };
    let projects = projects.as_object().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Claude projects must be a JSON object.",
        )
    })?;
    for (path, project) in projects {
        if !Path::new(path).is_absolute() || !project.is_object() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Claude project entries must map absolute paths to JSON objects.",
            ));
        }
        if project
            .get("hasTrustDialogAccepted")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid Claude directory trust value.",
            ));
        }
    }
    Ok(())
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

fn write_state(file: &Path, expected: &[u8], contents: &[u8]) -> io::Result<()> {
    let parent = file.parent().unwrap();
    let temp = file.with_file_name(format!(".claude-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&temp)?;
    let result = (|| {
        output.write_all(contents)?;
        output.write_all(b"\n")?;
        output.sync_all()?;
        let current = match fs::read(file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error),
        };
        if current != expected {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "Claude application state changed during trust preparation.",
            ));
        }
        fs::rename(&temp, file)?;
        #[cfg(unix)]
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

struct DirectoryLock(PathBuf);

impl DirectoryLock {
    fn acquire(config: &Path) -> io::Result<Self> {
        let mut path = config.as_os_str().to_os_string();
        path.push(".lock");
        let path = PathBuf::from(path);
        fs::create_dir(&path).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "Claude application state is locked.",
                )
            } else {
                error
            }
        })?;
        if let Err(error) = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path.join("ticketry-owner"))
        {
            let _ = fs::remove_dir(&path);
            return Err(error);
        }
        Ok(Self(path))
    }
}

impl Drop for DirectoryLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0.join("ticketry-owner"));
        let _ = fs::remove_dir(&self.0);
    }
}
