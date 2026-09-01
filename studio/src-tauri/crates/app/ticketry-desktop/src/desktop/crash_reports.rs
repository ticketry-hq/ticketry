use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::desktop::lifecycle::MAIN_WINDOW_LABEL;

#[derive(Debug)]
pub struct CrashReportsRuntime {
    report_collected: bool,
    reports_directory: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CrashCollectionOutcome {
    None,
    ReportCollected,
}

impl CrashReportsRuntime {
    pub fn new(data_directory: &Path, latest_report: Option<PathBuf>) -> Self {
        Self {
            report_collected: latest_report.is_some(),
            reports_directory: data_directory.join("crash-reports"),
        }
    }

    fn latest_collection_outcome(&self) -> CrashCollectionOutcome {
        if self.report_collected {
            CrashCollectionOutcome::ReportCollected
        } else {
            CrashCollectionOutcome::None
        }
    }

    fn reveal_folder(&self) -> Result<(), String> {
        reveal_in_file_manager(&self.reports_directory)
    }
}

fn require_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err("Crash Reports are restricted to the local main window".to_owned())
    }
}

#[tauri::command]
pub fn desktop_latest_crash_collection_outcome(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CrashReportsRuntime>,
) -> Result<CrashCollectionOutcome, String> {
    require_main_window(&window)?;
    Ok(state.latest_collection_outcome())
}

#[tauri::command]
pub fn desktop_reveal_crash_report_folder(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CrashReportsRuntime>,
) -> Result<(), String> {
    require_main_window(&window)?;
    state.reveal_folder()
}

fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            format!(
                "could not reveal Crash Report folder {}: {error}",
                path.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_outcome_exposes_only_whether_this_launch_collected_a_report() {
        let none = CrashReportsRuntime::new(Path::new("/tmp/ticketry"), None);
        let collected = CrashReportsRuntime::new(
            Path::new("/tmp/ticketry"),
            Some(PathBuf::from("/tmp/ticketry/crash-reports/report-1")),
        );

        assert_eq!(
            serde_json::to_value(none.latest_collection_outcome()).expect("serialize none"),
            serde_json::json!({ "status": "none" })
        );
        assert_eq!(
            serde_json::to_value(collected.latest_collection_outcome())
                .expect("serialize collected"),
            serde_json::json!({ "status": "report_collected" })
        );
    }
}
