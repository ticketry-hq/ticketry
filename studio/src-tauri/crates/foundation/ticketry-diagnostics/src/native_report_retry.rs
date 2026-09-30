use std::fs;
use std::path::Path;

use crate::crash_report::{
    write_private_json, CrashReportSidecar, CRASH_REPORTS_DIRECTORY, NATIVE_REPORT_NOT_FOUND,
    SIDECAR_FILE,
};

pub(crate) fn schedule(data_directory: &Path, diagnostic_reports_directory: &Path) {
    let data_directory = data_directory.to_owned();
    let diagnostic_reports_directory = diagnostic_reports_directory.to_owned();
    if let Err(error) = std::thread::Builder::new()
        .name("ticketry-native-report-retry".to_owned())
        .spawn(move || {
            if retry_pending(&data_directory, &diagnostic_reports_directory) {
                #[cfg(test)]
                let delay = std::time::Duration::from_millis(100);
                #[cfg(not(test))]
                let delay = std::time::Duration::from_secs(45);
                std::thread::sleep(delay);
                retry_pending(&data_directory, &diagnostic_reports_directory);
            }
        })
    {
        eprintln!("Ticketry could not schedule its native Crash Report retry: {error}");
    }
}

fn retry_pending(data_directory: &Path, diagnostic_reports_directory: &Path) -> bool {
    let reports_directory = data_directory.join(CRASH_REPORTS_DIRECTORY);
    let entries = match fs::read_dir(&reports_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return false,
        Err(error) => {
            eprintln!(
                "Ticketry could not inspect pending Crash Reports in {}: {error}",
                reports_directory.display()
            );
            return true;
        }
    };
    let mut pending = false;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                pending = true;
                eprintln!("Ticketry could not inspect a pending Crash Report: {error}");
                continue;
            }
        };
        if !entry.file_type().is_ok_and(|kind| kind.is_dir())
            || !entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("crash-report-"))
        {
            continue;
        }
        match retry_one(&entry.path(), diagnostic_reports_directory) {
            Ok(still_pending) => pending |= still_pending,
            Err(error) => {
                pending = true;
                eprintln!("Ticketry could not retry a native Crash Report: {error}");
            }
        }
    }
    pending
}

fn retry_one(report_directory: &Path, diagnostic_reports_directory: &Path) -> Result<bool, String> {
    let sidecar_path = report_directory.join(SIDECAR_FILE);
    let bytes = match fs::read(&sidecar_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "could not read {}: {error}",
                sidecar_path.display()
            ))
        }
    };
    let mut sidecar = serde_json::from_slice::<CrashReportSidecar>(&bytes)
        .map_err(|error| format!("could not read {}: {error}", sidecar_path.display()))?;
    if sidecar.native_report != NATIVE_REPORT_NOT_FOUND {
        return Ok(false);
    }
    let Some(file_name) = crate::native_crash_report::copy_matching_report(
        diagnostic_reports_directory,
        report_directory,
        sidecar.session_started_at,
        sidecar.session_ended_at,
    )?
    else {
        return Ok(true);
    };
    sidecar.native_report = file_name.clone();
    let partial = report_directory.join(format!(".{SIDECAR_FILE}.partial"));
    if let Err(error) = write_private_json(&partial, &sidecar).and_then(|()| {
        fs::rename(&partial, &sidecar_path)
            .map_err(|error| format!("could not publish {}: {error}", sidecar_path.display()))
    }) {
        let _ = fs::remove_file(&partial);
        let _ = fs::remove_file(report_directory.join(file_name));
        return Err(error);
    }
    Ok(false)
}
