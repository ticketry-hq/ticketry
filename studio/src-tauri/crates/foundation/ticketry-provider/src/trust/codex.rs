use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use toml_edit::{value, DocumentMut, Item, Table};

#[cfg(test)]
use std::sync::{mpsc, Mutex};

use super::{
    atomic_exchange, DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, ProviderFailure,
};
use crate::Provider;

pub(super) fn inspect(context: DirectoryTrustContext<'_>) -> DirectoryTrustInspection {
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
    prepare_inner(context, approval).unwrap_or_else(|error| {
        DirectoryTrustPreparation::Failed(ProviderFailure {
            message: error.to_string(),
        })
    })
}

fn inspect_inner(context: DirectoryTrustContext<'_>) -> io::Result<DirectoryTrustInspection> {
    let (directory, config) = validated_paths(context)?;
    let document = read_document(&config)?.1;
    Ok(match trust_level(&document, &directory)? {
        Some(true) => DirectoryTrustInspection::Trusted,
        Some(false) => DirectoryTrustInspection::Denied,
        None => DirectoryTrustInspection::ApprovalRequired(DirectoryTrustApproval {
            provider: Provider::Codex,
            directory,
            trust_file: config,
            provider_key: None,
        }),
    })
}

fn prepare_inner(
    context: DirectoryTrustContext<'_>,
    approval: Option<&DirectoryTrustApproval>,
) -> io::Result<DirectoryTrustPreparation> {
    let (directory, config) = validated_paths(context)?;
    let (_, document) = read_document(&config)?;
    match trust_level(&document, &directory)? {
        Some(true) => return Ok(DirectoryTrustPreparation::AlreadyTrusted),
        Some(false) => return Ok(DirectoryTrustPreparation::Denied),
        None => {}
    }
    if approval.is_none_or(|approval| {
        approval.provider != Provider::Codex
            || approval.directory != directory
            || approval.trust_file != config
    }) {
        return Ok(DirectoryTrustPreparation::ApprovalRequired);
    }

    let parent = config.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Codex config requires a parent directory.",
        )
    })?;
    fs::create_dir_all(parent)?;
    let lock = DirectoryLock::acquire(&config)?;
    let (_, document) = read_document(&config)?;
    match trust_level(&document, &directory)? {
        Some(true) => return Ok(DirectoryTrustPreparation::AlreadyTrusted),
        Some(false) => return Ok(DirectoryTrustPreparation::Denied),
        None => {}
    }

    let result = write_trust(&config, &directory);
    drop(lock);
    result
}

fn validated_paths(context: DirectoryTrustContext<'_>) -> io::Result<(PathBuf, PathBuf)> {
    if !context.directory.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Codex trust requires an absolute directory path.",
        ));
    }
    let directory = context.directory.canonicalize()?;
    if !directory.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Codex trust requires an existing directory.",
        ));
    }
    Ok((directory, config_file(context.trust_file)?))
}

fn config_file(configured: Option<&Path>) -> io::Result<PathBuf> {
    let config = if let Some(configured) = configured {
        configured.to_path_buf()
    } else if let Some(home) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        PathBuf::from(home).join("config.toml")
    } else {
        std::env::home_dir()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Cannot determine Codex's home directory.",
                )
            })?
            .join(".codex/config.toml")
    };
    if !config.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Codex configuration paths must be absolute.",
        ));
    }
    Ok(config)
}

fn read_document(file: &Path) -> io::Result<(Vec<u8>, DocumentMut)> {
    if let Ok(metadata) = fs::symlink_metadata(file) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Codex config must be a regular, non-symlinked file.",
            ));
        }
    }
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error),
    };
    let text = std::str::from_utf8(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let document = text
        .parse::<DocumentMut>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok((bytes, document))
}

fn trust_level(document: &DocumentMut, directory: &Path) -> io::Result<Option<bool>> {
    let Some(projects) = document.get("projects") else {
        return Ok(None);
    };
    let projects = projects.as_table().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Codex projects must be a TOML table.",
        )
    })?;
    let key = directory.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Codex project paths must be UTF-8.",
        )
    })?;
    let Some(project) = projects.get(key) else {
        return Ok(None);
    };
    let table = project.as_table_like().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Codex project entries must be TOML tables.",
        )
    })?;
    match table.get("trust_level").and_then(Item::as_str) {
        Some("trusted") => Ok(Some(true)),
        Some("untrusted") => Ok(Some(false)),
        None if !table.contains_key("trust_level") => Ok(None),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid Codex project trust level.",
        )),
    }
}

fn write_trust(file: &Path, directory: &Path) -> io::Result<DirectoryTrustPreparation> {
    let parent = file.parent().unwrap();
    ensure_file(file)?;
    let (mut installed, _) = read_document(file)?;
    let mut source = installed.clone();
    let mut source_file = file.to_path_buf();
    let mut displaced_files = Vec::new();

    // ponytail: bounded retries avoid livelock; use the resident app-server if sustained churn matters.
    for _ in 0..16 {
        let (contents, outcome) = match trust_edit(&source, directory) {
            Ok((contents, outcome)) => (contents, Ok(outcome)),
            Err(error) => (source.clone(), Err(error)),
        };
        let temp = write_temp(file, &source_file, &contents)?;
        pause_before_replace();
        if let Err(error) = atomic_exchange::exchange(&temp, file) {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
        #[cfg(unix)]
        fs::File::open(parent)?.sync_all()?;
        let displaced = fs::read(&temp)?;
        if displaced == installed {
            let _ = fs::remove_file(temp);
            for displaced_file in displaced_files {
                let _ = fs::remove_file(displaced_file);
            }
            return outcome;
        }
        installed = contents;
        source = displaced;
        source_file = temp.clone();
        displaced_files.push(temp);
    }
    Err(io::Error::new(
        io::ErrorKind::WouldBlock,
        "Codex configuration kept changing during trust preparation.",
    ))
}

fn trust_edit(source: &[u8], directory: &Path) -> io::Result<(Vec<u8>, DirectoryTrustPreparation)> {
    let text = std::str::from_utf8(source)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut document = text
        .parse::<DocumentMut>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    match trust_level(&document, directory)? {
        Some(true) => return Ok((source.to_vec(), DirectoryTrustPreparation::AlreadyTrusted)),
        Some(false) => return Ok((source.to_vec(), DirectoryTrustPreparation::Denied)),
        None => {}
    }
    let key = directory.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "Codex project paths must be UTF-8.",
        )
    })?;
    if !document.contains_key("projects") {
        document["projects"] = Item::Table(Table::new());
    }
    let projects = document["projects"].as_table_mut().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Codex projects must be a TOML table.",
        )
    })?;
    if !projects.contains_key(key) {
        projects.insert(key, Item::Table(Table::new()));
    }
    projects[key]["trust_level"] = value("trusted");
    Ok((
        document.to_string().into_bytes(),
        DirectoryTrustPreparation::Prepared,
    ))
}

fn ensure_file(file: &Path) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(file) {
        Ok(output) => output.sync_all(),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error),
    }
}

fn write_temp(file: &Path, source: &Path, contents: &[u8]) -> io::Result<PathBuf> {
    let temp = file.with_file_name(format!(".config-{}.tmp", uuid::Uuid::new_v4()));
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
        output.sync_all()?;
        if let Ok(metadata) = fs::metadata(source) {
            fs::set_permissions(&temp, metadata.permissions())?;
            output.sync_all()?;
        }
        Ok(temp.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
static BEFORE_REPLACE: Mutex<Option<(mpsc::SyncSender<()>, mpsc::Receiver<()>)>> = Mutex::new(None);

#[cfg(test)]
fn pause_before_replace() {
    let Some((ready, resume)) = BEFORE_REPLACE.lock().unwrap().take() else {
        return;
    };
    ready.send(()).unwrap();
    resume.recv().unwrap();
}

#[cfg(not(test))]
fn pause_before_replace() {}

struct DirectoryLock(PathBuf);

impl DirectoryLock {
    fn acquire(config: &Path) -> io::Result<Self> {
        let mut path = config.as_os_str().to_os_string();
        path.push(".lock");
        let path = PathBuf::from(path);
        fs::create_dir(&path).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                io::Error::new(io::ErrorKind::WouldBlock, "Codex configuration is locked.")
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_contract;

    #[test]
    fn trust_write_preserves_an_external_atomic_update_at_commit() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("module");
        let config = root.path().join("config.toml");
        fs::create_dir(&directory).unwrap();
        fs::write(&config, "model = \"initial\"\n").unwrap();
        let context = DirectoryTrustContext {
            directory: &directory,
            trust_file: Some(&config),
        };
        let DirectoryTrustInspection::ApprovalRequired(approval) =
            provider_contract(Provider::Codex).inspect_directory_trust(context)
        else {
            panic!("directory should require approval");
        };
        let (ready_tx, ready_rx) = mpsc::sync_channel(0);
        let (resume_tx, resume_rx) = mpsc::sync_channel(0);
        *BEFORE_REPLACE.lock().unwrap() = Some((ready_tx, resume_rx));

        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                provider_contract(Provider::Codex).prepare_directory_trust(context, Some(&approval))
            });
            ready_rx.recv().unwrap();
            let external = root.path().join("external.toml");
            fs::write(&external, "model = \"external\"\n").unwrap();
            fs::rename(external, &config).unwrap();
            resume_tx.send(()).unwrap();
            assert_eq!(worker.join().unwrap(), DirectoryTrustPreparation::Prepared);
        });
        let contents = fs::read_to_string(config).unwrap();
        assert!(contents.contains("model = \"external\""));
        assert!(contents.contains("trust_level = \"trusted\""));
    }
}
