use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use toml_edit::{value, Array, DocumentMut, Item, Table};

/// Prepare the run's Codex profile without changing the user configuration or CODEX_HOME.
///
/// The caller validates registration of `selected_profile` before calling this operation.
/// The returned profile resets only `ticketry`; the launch's CLI override then supplies its
/// credentialed server. Keep this file for the active run and prepare it again on resume.
/// Repeated preparation for the same run uses the same filename and avoids identical writes.
pub fn prepare_codex_run_mcp_profile(
    agent_run_id: &str,
    selected_profile: Option<&str>,
    codex_home: Option<&Path>,
) -> io::Result<String> {
    let run = uuid::Uuid::parse_str(agent_run_id)
        .map_err(|_| invalid("Codex MCP isolation requires a valid run UUID."))?;
    let name = format!("ticketry-run-{}", run.simple());
    let home = resolve_home(codex_home)?;
    let mut document = match selected_profile {
        Some(selected) => {
            validate_profile_name(selected)?;
            if selected == name {
                return Err(invalid(
                    "The original Codex profile cannot be the run profile.",
                ));
            }
            parse(&read_regular(
                &home.join(format!("{selected}.config.toml")),
            )?)?
        }
        None => DocumentMut::new(),
    };
    if !document.contains_key("mcp_servers") {
        document["mcp_servers"] = Item::Table(Table::new());
    }
    document["mcp_servers"]
        .as_table_like_mut()
        .ok_or_else(|| invalid("Codex profile mcp_servers must be a table."))?
        .insert("ticketry", value(Array::new()));
    let contents = document.to_string().into_bytes();

    fs::create_dir_all(&home)?;
    let metadata = fs::symlink_metadata(&home)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(invalid("Codex home must be a non-symlinked directory."));
    }
    writable(&metadata)?;
    let destination = home.join(format!("{name}.config.toml"));
    let _lock = ProfileLock::acquire(&destination)?;
    match fs::symlink_metadata(&destination) {
        Ok(metadata) => {
            writable(&metadata)?;
            let installed = read_regular(&destination)?;
            parse(&installed)?;
            if installed == contents {
                return Ok(name);
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    atomic_write(&destination, &contents)?;
    Ok(name)
}

fn resolve_home(configured: Option<&Path>) -> io::Result<PathBuf> {
    let home = if let Some(home) = configured {
        home.to_path_buf()
    } else if let Some(home) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        PathBuf::from(home)
    } else {
        std::env::home_dir()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Cannot determine Codex home."))?
            .join(".codex")
    };
    if !home.is_absolute() {
        return Err(invalid("Codex home must be an absolute path."));
    }
    Ok(home)
}

fn validate_profile_name(name: &str) -> io::Result<()> {
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(invalid(
            "Codex profile names must contain only letters, digits, '-' or '_'.",
        ));
    }
    Ok(())
}

fn read_regular(path: &Path) -> io::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(invalid(
            "Codex profile must be a regular, non-symlinked file.",
        ));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut contents = Vec::new();
    options.open(path)?.read_to_end(&mut contents)?;
    Ok(contents)
}

fn parse(contents: &[u8]) -> io::Result<DocumentMut> {
    std::str::from_utf8(contents)
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "Codex profile is not valid UTF-8.",
            )
        })?
        .parse()
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "Codex profile contains invalid TOML.",
            )
        })
}

fn writable(metadata: &fs::Metadata) -> io::Result<()> {
    if metadata.permissions().readonly() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Codex run profile location is read-only.",
        ));
    }
    Ok(())
}

fn atomic_write(destination: &Path, contents: &[u8]) -> io::Result<()> {
    let temporary =
        destination.with_file_name(format!(".ticketry-profile-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options.open(&temporary)?;
        output.write_all(contents)?;
        output.sync_all()?;
        // Only Ticketry's per-run artifact is replaced; originals are never write targets.
        fs::rename(&temporary, destination)?;
        #[cfg(unix)]
        fs::File::open(destination.parent().unwrap())?.sync_all()?;
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

struct ProfileLock(PathBuf);

impl ProfileLock {
    fn acquire(destination: &Path) -> io::Result<Self> {
        let lock = destination.with_extension("toml.ticketry-lock");
        fs::create_dir(&lock).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "Codex run profile is being prepared.",
                )
            } else {
                error
            }
        })?;
        Ok(Self(lock))
    }
}

impl Drop for ProfileLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
