//! Owner-liveness contracts across initial and recovery backend launches.

use crate::supervisor::{
    BackendCommand, CommandTable, Supervisor, SupervisorEvent, SupervisorOptions,
};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

static TEMP_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

#[test]
fn initial_and_recovery_backend_launches_receive_fresh_liveness_readers() {
    let first_launch_marker = unique_temp_path("supervisor-owner-liveness-first");
    let descriptor_record = unique_temp_path("supervisor-owner-liveness-record");
    let replacement_eof = unique_temp_path("supervisor-owner-liveness-eof");
    let log_path = unique_temp_path("supervisor-owner-liveness.log");
    let table = owner_liveness_table(
        &first_launch_marker,
        &descriptor_record,
        &replacement_eof,
        log_path,
    );
    let mut options = fast_options();
    options.restart_limit = 2;
    let mut supervisor = Supervisor::new(table, options);

    supervisor
        .launch()
        .expect("initial backend launch is ready");
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        supervisor.poll().expect("backend recovery succeeds");
        let launches = fs::read_to_string(&descriptor_record).unwrap_or_default();
        if launches.lines().count() >= 2 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "replacement backend was not launched"
        );
        thread::sleep(Duration::from_millis(10));
    }

    assert_eq!(
        fs::read_to_string(&descriptor_record)
            .expect("descriptor record")
            .lines()
            .count(),
        2,
        "both backend processes received a valid private reader"
    );
    assert_eq!(restarting_attempts(&supervisor), vec![1]);
    assert!(
        supervisor
            .release_and_wait_for_backend_owner_eof_for_test(Duration::from_secs(3))
            .expect("wait for replacement owner EOF"),
        "replacement exits when its fresh writer closes"
    );
    assert_eq!(
        fs::read_to_string(replacement_eof).expect("replacement EOF evidence"),
        "replacement-owner-eof"
    );
    supervisor
        .shutdown()
        .expect("released supervisor stays idempotent");
}

fn owner_liveness_table(
    first_launch_marker: &Path,
    descriptor_record: &Path,
    replacement_eof: &Path,
    log_path: PathBuf,
) -> CommandTable {
    let script = r#"
        fd=$1
        test "$0" = --owner-fd || exit 71
        test -e "/dev/fd/$fd" || exit 72
        printf '%s\n' "$fd" >> "$MUXED_LIVENESS_RECORD"
        printf 'MUXED_READY service=backend port=%s\n' "$MUXED_BACKEND_PORT"
        if [ ! -e "$MUXED_FIRST_LAUNCH_MARKER" ]; then
            : > "$MUXED_FIRST_LAUNCH_MARKER"
            sleep 0.05
            exit 37
        fi
        if IFS= read -r _ <&"$fd"; then exit 73; fi
        printf 'replacement-owner-eof' > "$MUXED_REPLACEMENT_EOF"
    "#;
    CommandTable {
        backend: BackendCommand {
            program: PathBuf::from("/bin/sh"),
            fixed_arguments: vec![OsString::from("-c"), OsString::from(script)],
            environment: vec![
                (
                    OsString::from("MUXED_FIRST_LAUNCH_MARKER"),
                    first_launch_marker.as_os_str().to_os_string(),
                ),
                (
                    OsString::from("MUXED_LIVENESS_RECORD"),
                    descriptor_record.as_os_str().to_os_string(),
                ),
                (
                    OsString::from("MUXED_REPLACEMENT_EOF"),
                    replacement_eof.as_os_str().to_os_string(),
                ),
            ],
            pass_port_argument: false,
            requires_owner_liveness: true,
        },
        mcp: None,
        mcp_port_path: log_path.with_extension("mcp-port"),
        sidecar_log_path: log_path,
    }
}

fn fast_options() -> SupervisorOptions {
    SupervisorOptions {
        readiness_timeout: Duration::from_millis(300),
        shutdown_grace: Duration::from_millis(80),
        bind_retry_timeout: Duration::from_millis(100),
        bind_retry_interval: Duration::from_millis(10),
        liveness_probe_interval: Duration::from_millis(20),
        liveness_probe_timeout: Duration::from_millis(20),
        liveness_failure_threshold: 3,
        restart_limit: 1,
        restart_backoff: vec![Duration::ZERO],
        healthy_reset_interval: Duration::from_secs(1),
        log_limit_bytes: 512,
        sidecar_log_limit_bytes: 512,
        sidecar_log_generations: 3,
        port_candidates: vec![0],
        mcp_port_candidates: vec![0],
        mcp_required: true,
    }
}

fn unique_temp_path(prefix: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "{prefix}-{}-{}",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
}

fn restarting_attempts(supervisor: &Supervisor) -> Vec<usize> {
    supervisor
        .events()
        .into_iter()
        .filter_map(|event| match event {
            SupervisorEvent::Restarting { service, attempt } if service == "backend" => {
                Some(attempt)
            }
            _ => None,
        })
        .collect()
}
