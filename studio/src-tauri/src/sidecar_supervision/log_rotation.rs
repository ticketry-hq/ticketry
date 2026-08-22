//! The on-disk sidecar log and its size bound.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

pub(super) const SIDECAR_LOG_FILE_NAME: &str = "sidecar.log";
pub(super) const DEVELOPMENT_LOG_PATH_ENV: &str = "MUXED_DEVELOPMENT_LOG_PATH";

pub fn sidecar_log_path(data_directory: impl AsRef<Path>) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(configured) = std::env::var_os(DEVELOPMENT_LOG_PATH_ENV) {
        let configured = PathBuf::from(configured);
        if configured.is_absolute() {
            return configured;
        }
    }
    data_directory.as_ref().join(SIDECAR_LOG_FILE_NAME)
}

pub(super) struct RotatingSidecarLog {
    pub(super) path: PathBuf,
    pub(super) per_generation_limit: u64,
    pub(super) generations: usize,
}

impl RotatingSidecarLog {
    pub(super) fn new(
        path: PathBuf,
        total_limit: usize,
        generations: usize,
    ) -> std::io::Result<Self> {
        let generations = generations.max(1);
        let per_generation_limit = (total_limit / generations) as u64;
        let log = Self {
            path,
            per_generation_limit,
            generations,
        };
        log.open_active()?;
        Ok(log)
    }

    pub(super) fn push(&mut self, line: &str) -> std::io::Result<()> {
        if self.per_generation_limit == 0 {
            return Ok(());
        }
        let max_line_bytes = self.per_generation_limit.saturating_sub(1) as usize;
        let end = if line.len() <= max_line_bytes {
            line.len()
        } else {
            line.char_indices()
                .map(|(index, _)| index)
                .take_while(|index| *index <= max_line_bytes)
                .last()
                .unwrap_or(0)
        };
        let bytes = &line.as_bytes()[..end];
        let write_bytes = bytes.len() as u64 + 1;
        let active_bytes = fs::metadata(&self.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if active_bytes > 0 && active_bytes.saturating_add(write_bytes) > self.per_generation_limit
        {
            self.rotate()?;
        }
        let mut file = self.open_active()?;
        file.write_all(bytes)?;
        file.write_all(b"\n")?;
        file.flush()
    }

    pub(super) fn rotate(&self) -> std::io::Result<()> {
        for generation in (1..self.generations).rev() {
            let source = if generation == 1 {
                self.path.clone()
            } else {
                self.generation_path(generation - 1)
            };
            if !source.exists() {
                continue;
            }
            let destination = self.generation_path(generation);
            if destination.exists() {
                fs::remove_file(&destination)?;
            }
            fs::rename(source, destination)?;
        }
        if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        self.open_active().map(|_| ())
    }

    pub(super) fn generation_path(&self, generation: usize) -> PathBuf {
        self.path.with_file_name(format!(
            "{}.{generation}",
            self.path
                .file_name()
                .expect("sidecar log path has a file name")
                .to_string_lossy()
        ))
    }

    pub(super) fn open_active(&self) -> std::io::Result<File> {
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        options.mode(0o600);
        let file = options.open(&self.path)?;
        #[cfg(unix)]
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        Ok(file)
    }
}
