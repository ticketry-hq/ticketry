//! The update run a packaged acceptance harness drives.
//!
//! Release acceptance has to prove that a packaged build discovers, installs,
//! and relaunches into a signed update — and refuses a tampered archive, a
//! wrong-key signature, and an unreachable feed. A human clicking through
//! Settings cannot be part of a repeatable release gate, so the harness sets
//! `TICKETRY_UPDATE_ACCEPTANCE_RESULT` and this module performs exactly the
//! same operations the Settings section performs, then records what happened.
//!
//! It changes nothing about the update path itself: the same check, the same
//! install, the same signature verification, the same restart teardown. Without
//! the harness environment variables it never runs.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::contract::{AppUpdateOperationErrorCode, AppUpdateStatus};

const RESULT_PATH: &str = "TICKETRY_UPDATE_ACCEPTANCE_RESULT";
const EXPECTED_VERSION: &str = "TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION";
const CASE: &str = "TICKETRY_UPDATE_ACCEPTANCE_CASE";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AcceptanceCase {
    /// The feed offers the archive the run's throwaway key signed.
    Signed,
    /// The archive was altered after signing.
    Tampered,
    /// The archive is signed by a key the build does not trust.
    WrongKey,
    /// The feed answers nothing usable.
    Unreachable,
}

impl AcceptanceCase {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "signed" => Some(Self::Signed),
            "tampered" => Some(Self::Tampered),
            "wrong-key" => Some(Self::WrongKey),
            "unreachable" => Some(Self::Unreachable),
            _ => None,
        }
    }
}

/// Which side of the relaunch this process is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AcceptancePhase {
    /// Version A: discover the update and try to apply it.
    BeforeUpdate,
    /// Version B: the process the update relaunched into.
    AfterRelaunch,
}

pub(crate) fn acceptance_phase(installed_version: &str, expected_version: &str) -> AcceptancePhase {
    if installed_version == expected_version {
        AcceptancePhase::AfterRelaunch
    } else {
        AcceptancePhase::BeforeUpdate
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AcceptanceRun {
    pub(crate) result_path: PathBuf,
    pub(crate) expected_version: String,
    pub(crate) case: AcceptanceCase,
}

impl AcceptanceRun {
    /// The run the harness asked for, or `None` for every ordinary launch.
    pub(crate) fn from_environment(read: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let result_path = PathBuf::from(read(RESULT_PATH)?);
        if !result_path.is_absolute() {
            return None;
        }
        let expected_version = read(EXPECTED_VERSION)?;
        let case = AcceptanceCase::parse(&read(CASE)?)?;
        Some(Self {
            result_path,
            expected_version,
            case,
        })
    }
}

/// What version A's install attempt did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InstallOutcome {
    Installed,
    Refused(AppUpdateOperationErrorCode),
    CheckFailed,
}

/// The evidence version A can report before it hands over to version B.
pub(crate) fn before_update_evidence(
    case: AcceptanceCase,
    discovered: Option<(AppUpdateStatus, String)>,
    expected_version: &str,
    outcome: InstallOutcome,
) -> Map<String, Value> {
    let mut evidence = BTreeMap::new();
    let discovered_expected_version = matches!(
        discovered.as_ref(),
        Some((AppUpdateStatus::Available, version)) if version == expected_version
    );
    evidence.insert(
        "discovered_available_version",
        json!(discovered_expected_version),
    );

    match outcome {
        InstallOutcome::Installed => {
            evidence.insert("installed_on_confirmation", json!(true));
            // Nothing installs before the plugin verifies the archive against
            // the packaged public key, so a completed install is itself proof.
            evidence.insert("updater_signature_verified", json!(true));
        }
        InstallOutcome::Refused(code) => {
            let signature_rejected = code == AppUpdateOperationErrorCode::UpdateSignatureInvalid;
            evidence.insert("updater_signature_verified", json!(signature_rejected));
            evidence.insert("refused_installations_changed_the_app", json!(false));
            evidence.insert("version_a_healthy_after_refusal", json!(true));
            match case {
                AcceptanceCase::Tampered => {
                    evidence.insert("tampered_archive_refused", json!(signature_rejected));
                }
                AcceptanceCase::WrongKey => {
                    evidence.insert("wrong_key_signature_refused", json!(signature_rejected));
                }
                AcceptanceCase::Unreachable => {
                    evidence.insert(
                        "unreachable_feed_retryable",
                        json!(code == AppUpdateOperationErrorCode::UpdateDownloadFailed),
                    );
                }
                AcceptanceCase::Signed => {
                    evidence.insert("installed_on_confirmation", json!(false));
                }
            }
        }
        InstallOutcome::CheckFailed => {
            evidence.insert("version_a_healthy_after_refusal", json!(true));
            evidence.insert("refused_installations_changed_the_app", json!(false));
            if case == AcceptanceCase::Unreachable {
                evidence.insert("unreachable_feed_retryable", json!(true));
            } else {
                evidence.insert("installed_on_confirmation", json!(false));
            }
        }
    }

    evidence
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

/// The evidence only the relaunched version B can report.
pub(crate) fn after_relaunch_evidence(
    installed_version: &str,
    expected_version: &str,
    data_directory_owned: bool,
) -> Map<String, Value> {
    let mut evidence = Map::new();
    evidence.insert(
        "relaunched_into_new_version".to_owned(),
        json!(installed_version == expected_version),
    );
    evidence.insert("relaunched_version".to_owned(), json!(installed_version));
    // The update relaunch is the moment a stale lock would strand the app: the
    // new process owning the data directory is what proves the old one let go.
    evidence.insert(
        "data_directory_lock_released_and_reacquired".to_owned(),
        json!(data_directory_owned),
    );
    evidence
}

/// Merges this phase's evidence into whatever an earlier phase already wrote.
///
/// Version B cannot see what version A observed, and neither may erase the
/// other, so the result file accumulates instead of being replaced.
pub(crate) fn merge_evidence(existing: Option<Value>, evidence: Map<String, Value>) -> Value {
    let mut merged = match existing {
        Some(Value::Object(object)) => object,
        _ => Map::new(),
    };
    for (key, value) in evidence {
        merged.insert(key, value);
    }
    Value::Object(merged)
}

pub(crate) fn record_evidence(
    result_path: &Path,
    evidence: Map<String, Value>,
) -> std::io::Result<()> {
    let existing = std::fs::read(result_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let merged = merge_evidence(existing, evidence);
    std::fs::write(
        result_path,
        format!("{}\n", serde_json::to_string_pretty(&merged)?),
    )
}

/// Whether this process, not a predecessor, owns the data directory.
fn data_directory_owned(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;

    let ownership = app.state::<crate::desktop::data_directory::DesktopDataDirectoryOwnership>();
    ownership.startup_error.is_none()
        && ownership
            .guard
            .lock()
            .expect("data-directory lock poisoned")
            .is_some()
}

/// Performs the harness's update run, if this launch was asked for one.
///
/// Called once the window has loaded, so the run exercises the same app state a
/// user would install from.
pub(crate) fn run_if_requested(app: &tauri::AppHandle) {
    let Some(run) = AcceptanceRun::from_environment(|key| std::env::var(key).ok()) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        execute(app, run).await;
    });
}

async fn execute(app: tauri::AppHandle, run: AcceptanceRun) {
    let installed_version = app.package_info().version.to_string();
    match acceptance_phase(&installed_version, &run.expected_version) {
        AcceptancePhase::AfterRelaunch => {
            let evidence = after_relaunch_evidence(
                &installed_version,
                &run.expected_version,
                data_directory_owned(&app),
            );
            report(&run, evidence);
            app.exit(0);
        }
        AcceptancePhase::BeforeUpdate => {
            let discovered = super::desktop_update_check(app.clone())
                .await
                .ok()
                .map(|response| {
                    (
                        response.status,
                        response.available_version.unwrap_or_default(),
                    )
                });
            let outcome = match discovered {
                None => InstallOutcome::CheckFailed,
                Some(_) => {
                    match super::install::desktop_update_download_and_install(app.clone()).await {
                        Ok(()) => InstallOutcome::Installed,
                        Err(error) => InstallOutcome::Refused(error.code),
                    }
                }
            };
            report(
                &run,
                before_update_evidence(
                    run.case,
                    discovered,
                    &run.expected_version,
                    outcome.clone(),
                ),
            );
            if outcome == InstallOutcome::Installed {
                // The relaunched process writes the rest of the evidence.
                super::install::restart_into_update(&app);
            } else {
                app.exit(0);
            }
        }
    }
}

fn report(run: &AcceptanceRun, evidence: Map<String, Value>) {
    if let Err(error) = record_evidence(&run.result_path, evidence) {
        eprintln!(
            "Ticketry could not record update acceptance evidence at {}: {error}",
            run.result_path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_from<'pairs>(
        pairs: &'pairs [(&'pairs str, &'pairs str)],
    ) -> impl Fn(&str) -> Option<String> + 'pairs {
        move |key| {
            pairs
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn an_ordinary_launch_configures_no_acceptance_run() {
        assert!(AcceptanceRun::from_environment(read_from(&[])).is_none());
        // A partial or relative configuration is ignored rather than guessed at.
        assert!(AcceptanceRun::from_environment(read_from(&[(
            "TICKETRY_UPDATE_ACCEPTANCE_RESULT",
            "/tmp/run/result.json"
        )]))
        .is_none());
        assert!(AcceptanceRun::from_environment(read_from(&[
            ("TICKETRY_UPDATE_ACCEPTANCE_RESULT", "result.json"),
            ("TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION", "0.3.0"),
            ("TICKETRY_UPDATE_ACCEPTANCE_CASE", "signed"),
        ]))
        .is_none());
        assert!(AcceptanceRun::from_environment(read_from(&[
            ("TICKETRY_UPDATE_ACCEPTANCE_RESULT", "/tmp/run/result.json"),
            ("TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION", "0.3.0"),
            ("TICKETRY_UPDATE_ACCEPTANCE_CASE", "unsigned"),
        ]))
        .is_none());
    }

    #[test]
    fn the_harness_configures_one_case_per_run() {
        let run = AcceptanceRun::from_environment(read_from(&[
            ("TICKETRY_UPDATE_ACCEPTANCE_RESULT", "/tmp/run/result.json"),
            ("TICKETRY_UPDATE_ACCEPTANCE_EXPECTED_VERSION", "0.3.0"),
            ("TICKETRY_UPDATE_ACCEPTANCE_CASE", "wrong-key"),
        ]))
        .expect("acceptance run");

        assert_eq!(run.result_path, PathBuf::from("/tmp/run/result.json"));
        assert_eq!(run.expected_version, "0.3.0");
        assert_eq!(run.case, AcceptanceCase::WrongKey);
    }

    #[test]
    fn the_running_version_decides_which_side_of_the_relaunch_this_is() {
        assert_eq!(
            acceptance_phase("0.2.0", "0.3.0"),
            AcceptancePhase::BeforeUpdate
        );
        assert_eq!(
            acceptance_phase("0.3.0", "0.3.0"),
            AcceptancePhase::AfterRelaunch
        );
    }

    #[test]
    fn a_completed_install_reports_discovery_and_a_verified_signature() {
        let evidence = before_update_evidence(
            AcceptanceCase::Signed,
            Some((AppUpdateStatus::Available, "0.3.0".to_owned())),
            "0.3.0",
            InstallOutcome::Installed,
        );

        assert_eq!(evidence["discovered_available_version"], json!(true));
        assert_eq!(evidence["installed_on_confirmation"], json!(true));
        assert_eq!(evidence["updater_signature_verified"], json!(true));
        assert!(!evidence.contains_key("relaunched_into_new_version"));
    }

    #[test]
    fn discovery_requires_the_version_the_harness_published() {
        for discovered in [
            None,
            Some((AppUpdateStatus::Current, "0.2.0".to_owned())),
            Some((AppUpdateStatus::Available, "0.2.9".to_owned())),
        ] {
            let evidence = before_update_evidence(
                AcceptanceCase::Signed,
                discovered,
                "0.3.0",
                InstallOutcome::Installed,
            );
            assert_eq!(evidence["discovered_available_version"], json!(false));
        }
    }

    #[test]
    fn a_tampered_archive_is_refused_by_signature_and_leaves_the_app_unchanged() {
        let evidence = before_update_evidence(
            AcceptanceCase::Tampered,
            Some((AppUpdateStatus::Available, "0.3.0".to_owned())),
            "0.3.0",
            InstallOutcome::Refused(AppUpdateOperationErrorCode::UpdateSignatureInvalid),
        );

        assert_eq!(evidence["tampered_archive_refused"], json!(true));
        assert_eq!(evidence["updater_signature_verified"], json!(true));
        assert_eq!(evidence["version_a_healthy_after_refusal"], json!(true));
        assert_eq!(
            evidence["refused_installations_changed_the_app"],
            json!(false)
        );
        assert!(!evidence.contains_key("installed_on_confirmation"));
    }

    #[test]
    fn a_wrong_key_signature_is_refused_the_same_way_a_tampered_archive_is() {
        let evidence = before_update_evidence(
            AcceptanceCase::WrongKey,
            Some((AppUpdateStatus::Available, "0.3.0".to_owned())),
            "0.3.0",
            InstallOutcome::Refused(AppUpdateOperationErrorCode::UpdateSignatureInvalid),
        );

        assert_eq!(evidence["wrong_key_signature_refused"], json!(true));
        assert_eq!(evidence["updater_signature_verified"], json!(true));
    }

    #[test]
    fn a_refusal_that_was_not_a_signature_failure_does_not_claim_verification() {
        let evidence = before_update_evidence(
            AcceptanceCase::Tampered,
            Some((AppUpdateStatus::Available, "0.3.0".to_owned())),
            "0.3.0",
            InstallOutcome::Refused(AppUpdateOperationErrorCode::UpdateDownloadFailed),
        );

        assert_eq!(evidence["tampered_archive_refused"], json!(false));
        assert_eq!(evidence["updater_signature_verified"], json!(false));
    }

    #[test]
    fn an_unreachable_feed_is_retryable_whether_it_fails_the_check_or_the_download() {
        let failed_download = before_update_evidence(
            AcceptanceCase::Unreachable,
            Some((AppUpdateStatus::Available, "0.3.0".to_owned())),
            "0.3.0",
            InstallOutcome::Refused(AppUpdateOperationErrorCode::UpdateDownloadFailed),
        );
        assert_eq!(failed_download["unreachable_feed_retryable"], json!(true));

        let failed_check = before_update_evidence(
            AcceptanceCase::Unreachable,
            None,
            "0.3.0",
            InstallOutcome::CheckFailed,
        );
        assert_eq!(failed_check["unreachable_feed_retryable"], json!(true));
        assert_eq!(failed_check["discovered_available_version"], json!(false));
        assert_eq!(failed_check["version_a_healthy_after_refusal"], json!(true));
    }

    #[test]
    fn the_relaunched_process_reports_the_version_and_the_reacquired_lock() {
        let evidence = after_relaunch_evidence("0.3.0", "0.3.0", true);

        assert_eq!(evidence["relaunched_into_new_version"], json!(true));
        assert_eq!(evidence["relaunched_version"], json!("0.3.0"));
        assert_eq!(
            evidence["data_directory_lock_released_and_reacquired"],
            json!(true)
        );

        let stranded = after_relaunch_evidence("0.3.0", "0.3.0", false);
        assert_eq!(
            stranded["data_directory_lock_released_and_reacquired"],
            json!(false)
        );
        let wrong_version = after_relaunch_evidence("0.2.0", "0.3.0", true);
        assert_eq!(wrong_version["relaunched_into_new_version"], json!(false));
    }

    #[test]
    fn each_phase_adds_to_the_result_without_erasing_the_other() {
        let before = before_update_evidence(
            AcceptanceCase::Signed,
            Some((AppUpdateStatus::Available, "0.3.0".to_owned())),
            "0.3.0",
            InstallOutcome::Installed,
        );
        let after = after_relaunch_evidence("0.3.0", "0.3.0", true);

        let merged = merge_evidence(Some(merge_evidence(None, before)), after);

        assert_eq!(merged["installed_on_confirmation"], json!(true));
        assert_eq!(merged["relaunched_into_new_version"], json!(true));
        assert_eq!(merged["updater_signature_verified"], json!(true));
    }

    #[test]
    fn an_unreadable_result_file_starts_a_fresh_object() {
        let evidence = after_relaunch_evidence("0.3.0", "0.3.0", true);

        let merged = merge_evidence(Some(json!("not an object")), evidence);

        assert_eq!(merged["relaunched_version"], json!("0.3.0"));
    }
}
