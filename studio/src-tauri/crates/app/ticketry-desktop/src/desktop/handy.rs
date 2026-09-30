use std::process::{Command, Stdio};

use crate::desktop::lifecycle::MAIN_WINDOW_LABEL;
use ticketry_diagnostics::FileLog;

const HANDY_EXECUTABLE: &str = "/Applications/Handy.app/Contents/MacOS/handy";
const TOGGLE_TRANSCRIPTION_ARGUMENT: &str = "--toggle-transcription";

fn record_failure(log: &FileLog, message: impl std::fmt::Display) {
    let _ = log.record(
        "desktop",
        "debug",
        "handy-toggle-transcription-failed",
        serde_json::json!({ "message": message.to_string() }),
    );
}

#[tauri::command]
pub(crate) fn desktop_toggle_handy_transcription(
    window: tauri::WebviewWindow,
    log: tauri::State<'_, FileLog>,
) {
    if window.label() != MAIN_WINDOW_LABEL {
        record_failure(&log, "command is restricted to the local main window");
        return;
    }

    if let Err(error) = Command::new(HANDY_EXECUTABLE)
        .arg(TOGGLE_TRANSCRIPTION_ARGUMENT)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        record_failure(&log, error);
    }
}
