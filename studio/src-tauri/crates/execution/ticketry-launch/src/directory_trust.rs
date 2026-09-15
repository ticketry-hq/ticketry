//! Persisted Gemini folder approval, explicitly requested during folder setup.
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use crate::Provider;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DirectoryTrustOutcome {
    Prepared,
    AlreadyTrusted,
    Refused,
}

pub struct DirectoryTrustSetup {
    provider: Provider,
    trust_file: PathBuf,
}

impl DirectoryTrustSetup {
    pub fn new(provider: Provider, trust_file: PathBuf) -> Self {
        Self {
            provider,
            trust_file,
        }
    }

    /// Resolve the installed Gemini CLI's persisted trust location.
    pub fn from_environment(provider: Provider) -> io::Result<Self> {
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
            return Err(io::Error::new(io::ErrorKind::InvalidInput,
                "Gemini trust environment paths must be absolute so setup and provider working directories resolve the same file."));
        }
        Ok(Self::new(provider, file))
    }

    /// Approve only this canonical folder. Existing provider denial requires a
    /// decision in Gemini itself; it is never overwritten by Ticketry.
    /// This does not grant hook trust, tool permissions, or MCP authentication.
    pub fn prepare(&self, directory: &Path, approved: bool) -> io::Result<DirectoryTrustOutcome> {
        if self.provider != Provider::Gemini {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Persisted directory trust is only verified for Gemini.",
            ));
        }
        let directory = directory.canonicalize()?;
        if !directory.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Trust setup requires an existing directory.",
            ));
        }
        if cfg!(unix) && directory.as_os_str().as_encoded_bytes().contains(&b'\\') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Gemini cannot represent backslashes in directory names.",
            ));
        }
        let key = normalize(&directory)?;
        let mut rules = read_rules(&self.trust_file)?;
        match matching_rule(&rules, &directory)? {
            Some(true) => return Ok(DirectoryTrustOutcome::AlreadyTrusted),
            Some(false) => return Ok(DirectoryTrustOutcome::Refused),
            None => {}
        }
        if !approved {
            return Ok(DirectoryTrustOutcome::Refused);
        }
        let file = std::path::absolute(&self.trust_file)?;
        fs::create_dir_all(file.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Trust file requires a parent directory.",
            )
        })?)?;
        let mut lock_path = file.as_os_str().to_os_string();
        lock_path.push(".lock");
        let lock_path = PathBuf::from(lock_path);
        fs::create_dir(&lock_path).map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "Gemini trusted folders are locked; retry after the provider finishes.",
                )
            } else {
                e
            }
        })?;
        let lock = DirectoryLock(lock_path);
        // ponytail: fail closed after a crash; remove this marker manually only
        // once no setup is running. Gemini's stale-lock rmdir cannot steal it.
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(lock.0.join("ticketry-owner"))?;
        rules = read_rules(&file)?;
        match matching_rule(&rules, &directory)? {
            Some(true) => return Ok(DirectoryTrustOutcome::AlreadyTrusted),
            Some(false) => return Ok(DirectoryTrustOutcome::Refused),
            None => {}
        }
        rules.insert(key.to_owned(), "TRUST_FOLDER".into());
        write_rules(&file, &rules)?;
        Ok(DirectoryTrustOutcome::Prepared)
    }
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
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Trusted folders must be a plain JSON object; comments are not supported: {e}"
                ),
            )
        })?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Default::default(),
        Err(e) => return Err(e),
    };
    if rules.keys().any(|path| !Path::new(path).is_absolute()) {
        return Err(io::Error::new(io::ErrorKind::InvalidData,
            "Relative Gemini trust rules depend on the provider working directory; use absolute paths before retrying."));
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

struct DirectoryLock(PathBuf);
impl Drop for DirectoryLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0.join("ticketry-owner"));
        let _ = fs::remove_dir(&self.0);
    }
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
        let _ = fs::remove_file(&temp);
    }
    result
}
