use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use crate::Provider;

mod atomic_exchange;
mod claude;
mod codex;

#[derive(Clone, Copy, Debug)]
pub struct DirectoryTrustContext<'a> {
    pub directory: &'a Path,
    pub trust_file: Option<&'a Path>,
    pub executable: Option<&'a Path>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectoryTrustApproval {
    provider: Provider,
    directory: PathBuf,
    trust_file: PathBuf,
    provider_key: Option<PathBuf>,
}

impl DirectoryTrustApproval {
    pub fn provider(&self) -> Provider {
        self.provider
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderFailure {
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DirectoryTrustInspection {
    Trusted,
    ApprovalRequired(DirectoryTrustApproval),
    Denied,
    Unsupported,
    Failed(ProviderFailure),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DirectoryTrustPreparation {
    Prepared,
    AlreadyTrusted,
    ApprovalRequired,
    Denied,
    Unsupported,
    Failed(ProviderFailure),
}

pub(crate) fn unsupported_inspection() -> DirectoryTrustInspection {
    DirectoryTrustInspection::Unsupported
}

pub(crate) fn unsupported_preparation() -> DirectoryTrustPreparation {
    DirectoryTrustPreparation::Unsupported
}

pub(crate) fn inspect_codex(context: DirectoryTrustContext<'_>) -> DirectoryTrustInspection {
    codex::inspect(context)
}

pub(crate) fn inspect_claude(context: DirectoryTrustContext<'_>) -> DirectoryTrustInspection {
    claude::inspect(context)
}

pub(crate) fn prepare_codex(
    context: DirectoryTrustContext<'_>,
    approval: Option<&DirectoryTrustApproval>,
) -> DirectoryTrustPreparation {
    codex::prepare(context, approval)
}

pub(crate) fn prepare_claude(
    context: DirectoryTrustContext<'_>,
    approval: Option<&DirectoryTrustApproval>,
) -> DirectoryTrustPreparation {
    claude::prepare(context, approval)
}

pub(crate) fn inspect_gemini(context: DirectoryTrustContext<'_>) -> DirectoryTrustInspection {
    inspect_gemini_inner(context).unwrap_or_else(failed_inspection)
}

pub(crate) fn prepare_gemini(
    context: DirectoryTrustContext<'_>,
    approval: Option<&DirectoryTrustApproval>,
) -> DirectoryTrustPreparation {
    prepare_gemini_inner(context, approval).unwrap_or_else(failed_preparation)
}

fn inspect_gemini_inner(
    context: DirectoryTrustContext<'_>,
) -> io::Result<DirectoryTrustInspection> {
    let (directory, trust_file) = validated_paths(context)?;
    let rules = read_rules(&trust_file)?;
    Ok(match matching_rule(&rules, &directory)? {
        Some(true) => DirectoryTrustInspection::Trusted,
        Some(false) => DirectoryTrustInspection::Denied,
        None => DirectoryTrustInspection::ApprovalRequired(DirectoryTrustApproval {
            provider: Provider::Gemini,
            directory,
            trust_file,
            provider_key: None,
        }),
    })
}

fn prepare_gemini_inner(
    context: DirectoryTrustContext<'_>,
    approval: Option<&DirectoryTrustApproval>,
) -> io::Result<DirectoryTrustPreparation> {
    let (directory, trust_file) = validated_paths(context)?;
    let rules = read_rules(&trust_file)?;
    match matching_rule(&rules, &directory)? {
        Some(true) => return Ok(DirectoryTrustPreparation::AlreadyTrusted),
        Some(false) => return Ok(DirectoryTrustPreparation::Denied),
        None => {}
    }
    if approval.is_none_or(|approval| {
        approval.provider != Provider::Gemini
            || approval.directory != directory
            || approval.trust_file != trust_file
    }) {
        return Ok(DirectoryTrustPreparation::ApprovalRequired);
    }

    fs::create_dir_all(trust_file.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Trust file requires a parent directory.",
        )
    })?)?;
    let mut lock_path = trust_file.as_os_str().to_os_string();
    lock_path.push(".lock");
    let lock_path = PathBuf::from(lock_path);
    fs::create_dir(&lock_path).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "Provider trust configuration is locked.",
            )
        } else {
            error
        }
    })?;
    let lock = DirectoryLock(lock_path);
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock.0.join("ticketry-owner"))?;
    let mut rules = read_rules(&trust_file)?;
    match matching_rule(&rules, &directory)? {
        Some(true) => return Ok(DirectoryTrustPreparation::AlreadyTrusted),
        Some(false) => return Ok(DirectoryTrustPreparation::Denied),
        None => {}
    }
    rules.insert(normalize(&directory)?, "TRUST_FOLDER".into());
    write_rules(&trust_file, &rules)?;
    Ok(DirectoryTrustPreparation::Prepared)
}

fn validated_paths(context: DirectoryTrustContext<'_>) -> io::Result<(PathBuf, PathBuf)> {
    let directory = context.directory.canonicalize()?;
    if !directory.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Trust requires a directory.",
        ));
    }
    if cfg!(unix) && directory.as_os_str().as_encoded_bytes().contains(&b'\\') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Gemini cannot represent backslashes in directory names.",
        ));
    }
    Ok((directory, gemini_trust_file(context.trust_file)?))
}

fn gemini_trust_file(configured: Option<&Path>) -> io::Result<PathBuf> {
    if let Some(file) = configured {
        return std::path::absolute(file);
    }
    let nonempty = |name| std::env::var_os(name).filter(|value| !value.is_empty());
    let file = match nonempty("GEMINI_CLI_TRUSTED_FOLDERS_PATH") {
        Some(path) => PathBuf::from(path),
        None => nonempty("GEMINI_CLI_HOME")
            .map(PathBuf::from)
            .or_else(std::env::home_dir)
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Cannot determine Gemini's home directory.",
                )
            })?
            .join(".gemini/trustedFolders.json"),
    };
    if !file.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Gemini trust environment paths must be absolute.",
        ));
    }
    Ok(file)
}

fn normalize(path: &Path) -> io::Result<String> {
    let absolute = std::path::absolute(path)?;
    let mut cleaned = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::ParentDir => {
                cleaned.pop();
            }
            std::path::Component::CurDir => {}
            other => cleaned.push(other.as_os_str()),
        }
    }
    let text = cleaned
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Directory must be UTF-8."))?
        .replace('\\', "/");
    Ok(if cfg!(any(target_os = "macos", windows)) {
        text.to_lowercase()
    } else {
        text
    })
}

fn matching_rule(
    rules: &serde_json::Map<String, serde_json::Value>,
    directory: &Path,
) -> io::Result<Option<bool>> {
    let location = PathBuf::from(normalize(directory)?);
    let mut normalized = serde_json::Map::new();
    for (path, rule) in rules {
        normalized.insert(normalize(Path::new(path))?, rule.clone());
    }
    let mut longest = None;
    for (path, rule) in &normalized {
        let effective = if rule == "TRUST_PARENT" {
            Path::new(path).parent().unwrap_or(Path::new(path))
        } else {
            Path::new(path)
        };
        let resolved = effective
            .canonicalize()
            .unwrap_or_else(|_| effective.to_path_buf());
        let length = path.encode_utf16().count();
        if location.starts_with(normalize(&resolved)?)
            && longest.is_none_or(|(size, _)| length > size)
        {
            longest = Some((length, rule != "DO_NOT_TRUST"));
        }
    }
    Ok(longest.map(|(_, trusted)| trusted))
}

fn read_rules(file: &Path) -> io::Result<serde_json::Map<String, serde_json::Value>> {
    if fs::symlink_metadata(file).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Symlinked Gemini trust files are not supported.",
        ));
    }
    let rules: serde_json::Map<String, serde_json::Value> = match fs::read(file) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Default::default()),
        Err(error) => Err(error),
    }?;
    if rules.keys().any(|path| !Path::new(path).is_absolute()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Gemini trust rules must use absolute paths.",
        ));
    }
    if rules.values().any(|rule| {
        !matches!(
            rule.as_str(),
            Some("TRUST_FOLDER" | "TRUST_PARENT" | "DO_NOT_TRUST")
        )
    }) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid Gemini directory trust rule.",
        ));
    }
    Ok(rules)
}

fn write_rules(file: &Path, rules: &serde_json::Map<String, serde_json::Value>) -> io::Result<()> {
    let temp = file.with_file_name(format!(".trustedFolders-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&temp)?;
    let result = (|| {
        output.write_all(&serde_json::to_vec_pretty(rules)?)?;
        output.sync_all()?;
        fs::rename(&temp, file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

struct DirectoryLock(PathBuf);

impl Drop for DirectoryLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0.join("ticketry-owner"));
        let _ = fs::remove_dir(&self.0);
    }
}

fn failed_inspection(error: io::Error) -> DirectoryTrustInspection {
    DirectoryTrustInspection::Failed(ProviderFailure {
        message: error.to_string(),
    })
}

fn failed_preparation(error: io::Error) -> DirectoryTrustPreparation {
    DirectoryTrustPreparation::Failed(ProviderFailure {
        message: error.to_string(),
    })
}
