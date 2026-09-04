use std::fs;
use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};

use super::*;

fn instant(text: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(text)
        .expect("test timestamp")
        .with_timezone(&Utc)
}

struct Database {
    root: tempfile::TempDir,
}

impl Database {
    fn new() -> Self {
        Self {
            root: tempfile::tempdir().expect("temporary directory"),
        }
    }

    fn path(&self) -> &Path {
        self.root.path()
    }

    fn with_crash(self, recorded_at: &str, body: &str) -> Self {
        fs::write(self.path().join(LAST_CRASH_FILE), recorded_at).expect("last crash");
        let run = self.path().join("8383f920.run");
        fs::create_dir_all(&run).expect("run directory");
        fs::write(run.join("crash.envelope"), body).expect("envelope");
        self
    }
}

fn report_directory() -> tempfile::TempDir {
    tempfile::tempdir().expect("report directory")
}

#[test]
fn collects_the_envelope_for_a_crash_inside_the_dead_session() {
    let database = Database::new().with_crash("2026-08-31T09:50:11.575141Z", "MDMP-body");
    let report = report_directory();

    let collected = copy_matching_report(
        database.path(),
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection");

    let file_name = collected.expect("an envelope for a crash inside the session");
    assert_eq!(file_name, "libghostty-crash-20260831T095011.575Z.envelope");
    assert_eq!(
        fs::read_to_string(report.path().join(file_name)).expect("copied envelope"),
        "MDMP-body"
    );
}

#[test]
fn ignores_a_crash_recorded_before_the_dead_session_started() {
    let database = Database::new().with_crash("2026-08-31T08:00:00Z", "older");
    let report = report_directory();

    let collected = copy_matching_report(
        database.path(),
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection");

    assert!(collected.is_none());
    assert!(fs::read_dir(report.path())
        .expect("report directory")
        .next()
        .is_none());
}

#[test]
fn ignores_a_crash_recorded_after_the_dead_session_ended() {
    let database = Database::new().with_crash("2026-08-31T10:30:00Z", "newer");
    let report = report_directory();

    assert!(copy_matching_report(
        database.path(),
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection")
    .is_none());
}

#[test]
fn reports_no_record_when_libghostty_never_crashed() {
    let database = Database::new();
    let report = report_directory();

    assert!(copy_matching_report(
        database.path(),
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection")
    .is_none());
}

#[test]
fn treats_an_unparseable_marker_as_no_record() {
    let database = Database::new().with_crash("not a timestamp", "body");
    let report = report_directory();

    assert!(copy_matching_report(
        database.path(),
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection")
    .is_none());
}

#[test]
fn reports_no_record_when_the_database_is_absent() {
    let missing = tempfile::tempdir().expect("temporary directory");
    let path = missing.path().join("never-created");
    let report = report_directory();

    assert!(copy_matching_report(
        &path,
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection")
    .is_none());
}

#[test]
fn collects_the_newest_envelope_when_several_runs_are_retained() {
    let database = Database::new().with_crash("2026-08-31T09:50:11Z", "older-run");
    let newer = database.path().join("b1c2d3e4.run");
    fs::create_dir_all(&newer).expect("newer run");
    let newest = newer.join("crash.envelope");
    fs::write(&newest, "newest-run").expect("newer envelope");
    let later = std::time::SystemTime::now() + Duration::from_secs(60);
    fs::File::open(&newest)
        .and_then(|file| file.set_times(fs::FileTimes::new().set_modified(later)))
        .expect("stamp the newer envelope");
    let report = report_directory();

    let file_name = copy_matching_report(
        database.path(),
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection")
    .expect("an envelope");

    assert_eq!(
        fs::read_to_string(report.path().join(file_name)).expect("copied envelope"),
        "newest-run"
    );
}

#[test]
fn collected_records_stay_private_to_the_user() {
    let database = Database::new().with_crash("2026-08-31T09:50:11Z", "body");
    let report = report_directory();

    let file_name = copy_matching_report(
        database.path(),
        report.path(),
        instant("2026-08-31T09:28:17Z"),
        instant("2026-08-31T09:52:00Z"),
    )
    .expect("collection")
    .expect("an envelope");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(report.path().join(&file_name))
            .expect("copied envelope")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    let _ = Utc.timestamp_opt(0, 0);
}
