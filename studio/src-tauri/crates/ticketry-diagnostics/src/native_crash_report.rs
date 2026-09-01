use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::Deserialize;

const TICKETRY_APP_NAME: &str = "Ticketry";
const TICKETRY_PROCESS_NAME: &str = "ticketry";
const TICKETRY_BUNDLE_ID: &str = "com.ticketry.desktop";
const IPS_HEADER_BYTE_LIMIT: u64 = 64 * 1024;

#[derive(Deserialize)]
struct IpsHeader {
    app_name: String,
    #[serde(rename = "bundleID")]
    bundle_id: Option<String>,
}

#[derive(Deserialize)]
struct IpsBody {
    #[serde(rename = "captureTime")]
    capture_time: String,
    #[serde(rename = "procName")]
    process_name: String,
    #[serde(rename = "bundleInfo")]
    bundle_info: Option<IpsBundleInfo>,
}

#[derive(Deserialize)]
struct IpsBundleInfo {
    #[serde(rename = "CFBundleIdentifier")]
    bundle_id: Option<String>,
}

pub(super) fn copy_matching_report(
    diagnostic_reports_directory: &Path,
    crash_report_directory: &Path,
    session_started_at: DateTime<Utc>,
    session_ended_at: DateTime<Utc>,
) -> Result<Option<String>, String> {
    let entries = match fs::read_dir(diagnostic_reports_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "could not list native Crash Reports in {}: {error}",
                diagnostic_reports_directory.display()
            ));
        }
    };
    let mut matching = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        if !entry.file_type().is_ok_and(|kind| kind.is_file())
            || entry.path().extension().and_then(|value| value.to_str()) != Some("ips")
        {
            continue;
        }
        let Some(timestamp) = matching_capture_time(&entry.path()) else {
            continue;
        };
        if timestamp >= session_started_at && timestamp <= session_ended_at {
            matching.push((timestamp, entry.path()));
        }
    }
    matching.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let Some((_, source)) = matching.pop() else {
        return Ok(None);
    };
    let Some(file_name) = source.file_name().and_then(|value| value.to_str()) else {
        return Ok(None);
    };
    let destination = crash_report_directory.join(file_name);
    let partial = crash_report_directory.join(format!(".{file_name}.partial"));
    if let Err(error) = fs::copy(&source, &partial) {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "could not copy native Crash Report {} to {}: {error}",
            source.display(),
            destination.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = fs::set_permissions(&partial, fs::Permissions::from_mode(0o600)) {
            let _ = fs::remove_file(&partial);
            return Err(format!(
                "could not protect native Crash Report {}: {error}",
                destination.display()
            ));
        }
    }
    if let Err(error) = fs::rename(&partial, &destination) {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "could not publish native Crash Report {}: {error}",
            destination.display()
        ));
    }
    Ok(Some(file_name.to_owned()))
}

fn matching_capture_time(path: &Path) -> Option<DateTime<Utc>> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut header = String::new();
    let bytes_read = (&mut reader)
        .take(IPS_HEADER_BYTE_LIMIT + 1)
        .read_line(&mut header)
        .ok()?;
    if bytes_read as u64 > IPS_HEADER_BYTE_LIMIT || !header.ends_with('\n') {
        return None;
    }
    let header = serde_json::from_str::<IpsHeader>(&header).ok()?;
    let body = serde_json::from_reader::<_, IpsBody>(&mut reader).ok()?;
    let process_matches = |name: &str| name == TICKETRY_APP_NAME || name == TICKETRY_PROCESS_NAME;
    let bundle_matches = [
        header.bundle_id.as_deref(),
        body.bundle_info
            .as_ref()
            .and_then(|bundle| bundle.bundle_id.as_deref()),
    ]
    .into_iter()
    .flatten()
    .all(|bundle_id| bundle_id == TICKETRY_BUNDLE_ID);
    if !process_matches(&header.app_name) || !process_matches(&body.process_name) || !bundle_matches
    {
        return None;
    }
    DateTime::parse_from_str(&body.capture_time, "%Y-%m-%d %H:%M:%S%.f %z")
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}
