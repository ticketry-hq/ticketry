use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use serde_json::Value;

pub(crate) fn state_file(configured: Option<&Path>) -> io::Result<PathBuf> {
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

pub(crate) fn read_state(file: &Path) -> io::Result<(Vec<u8>, Value)> {
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

pub(crate) fn write_state(file: &Path, expected: &[u8], contents: &[u8]) -> io::Result<()> {
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

pub(crate) struct DirectoryLock(PathBuf);

impl DirectoryLock {
    pub(crate) fn acquire(config: &Path) -> io::Result<Self> {
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
