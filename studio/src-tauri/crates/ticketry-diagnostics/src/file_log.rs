use std::ffi::OsString;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use chrono::{SecondsFormat, Utc};

pub const FILE_LOGGING_FLAG: &str = "--log-to-file";
const LOG_FILE_NAME: &str = "ticketry.log";

static PROCESS_FILE_LOG: OnceLock<FileLog> = OnceLock::new();

#[derive(Clone, Debug, Default)]
pub struct FileLog {
    path: Option<Arc<PathBuf>>,
}

impl FileLog {
    pub fn disabled() -> Self {
        Self::default()
    }

    fn enabled(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "could not create log directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let log = Self {
            path: Some(Arc::new(path)),
        };
        log.append_line(&format!(
            "{} [backend][info] file-logging-enabled",
            timestamp()
        ))?;
        Ok(log)
    }

    pub fn is_enabled(&self) -> bool {
        self.path.is_some()
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref().map(PathBuf::as_path)
    }

    pub fn append_line(&self, line: &str) -> Result<(), String> {
        let Some(path) = self.path() else {
            return Err("file logging is disabled".to_owned());
        };
        let flattened = line.replace('\r', "\\r").replace('\n', "\\n");
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(path)
            .map_err(|error| format!("could not open {}: {error}", path.display()))?;
        writeln!(file, "{flattened}")
            .map_err(|error| format!("could not append {}: {error}", path.display()))
    }

    pub fn record(
        &self,
        component: &str,
        level: &str,
        event: &str,
        details: serde_json::Value,
    ) -> Result<(), String> {
        self.append_line(&format!(
            "{} [{component}][{level}] {event} {details}",
            timestamp()
        ))
    }
}

pub fn file_logging_requested(arguments: &[OsString]) -> bool {
    arguments
        .iter()
        .any(|argument| argument == FILE_LOGGING_FLAG)
}

pub fn configure_process_file_log(
    requested: bool,
    data_directory: &Path,
    development_log_path: Option<PathBuf>,
) -> FileLog {
    if let Some(existing) = PROCESS_FILE_LOG.get() {
        return existing.clone();
    }
    let path = resolved_log_path(requested, data_directory, development_log_path);
    let log = match path {
        Some(path) => FileLog::enabled(path).unwrap_or_else(|error| {
            eprintln!("Ticketry file logging could not start: {error}");
            FileLog::disabled()
        }),
        None => FileLog::disabled(),
    };
    let _ = PROCESS_FILE_LOG.set(log.clone());
    log
}

fn resolved_log_path(
    requested: bool,
    data_directory: &Path,
    development_log_path: Option<PathBuf>,
) -> Option<PathBuf> {
    development_log_path.or_else(|| requested.then(|| data_directory.join(LOG_FILE_NAME)))
}

pub fn process_file_log() -> FileLog {
    PROCESS_FILE_LOG.get().cloned().unwrap_or_default()
}

pub fn record_story_move(level: &str, event: &str, details: serde_json::Value) {
    let log = process_file_log();
    if !log.is_enabled() {
        return;
    }
    if let Err(error) = log.record("backend", level, &format!("story-move.{event}"), details) {
        eprintln!("Ticketry could not append story-move diagnostics: {error}");
    }
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_file_logging_is_enabled_only_by_the_flag() {
        assert!(!file_logging_requested(&[]));
        assert!(file_logging_requested(&[OsString::from(FILE_LOGGING_FLAG)]));
        assert!(!file_logging_requested(&[OsString::from("--temp-sqlite")]));
    }

    #[test]
    fn production_uses_the_advertised_data_directory_log_path() {
        let data_directory = Path::new("/ticketry-data");
        assert_eq!(resolved_log_path(false, data_directory, None), None);
        assert_eq!(
            resolved_log_path(true, data_directory, None),
            Some(data_directory.join("ticketry.log"))
        );
        assert_eq!(
            resolved_log_path(
                false,
                data_directory,
                Some(PathBuf::from("/workspace/.ticketry-dev/logs/ticketry.log")),
            ),
            Some(PathBuf::from("/workspace/.ticketry-dev/logs/ticketry.log"))
        );
    }

    #[test]
    fn enabled_log_writes_single_line_records_to_ticketry_log() {
        let directory = tempfile::tempdir().expect("temporary log directory");
        let path = directory.path().join(LOG_FILE_NAME);
        let log = FileLog::enabled(path.clone()).expect("enable file log");

        log.record(
            "backend",
            "error",
            "story-move.reorder-failed",
            serde_json::json!({"id": "story-1", "message": "first\nsecond"}),
        )
        .expect("append diagnostic");

        let contents = std::fs::read_to_string(path).expect("read log");
        assert!(contents.contains("file-logging-enabled"));
        assert!(contents.contains("story-move.reorder-failed"));
        assert!(contents.contains(r#"first\nsecond"#));
        assert_eq!(contents.lines().count(), 2);
    }
}
