//! Explicit provider folder approval from the local main webview.
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
};

use serde::Serialize;
use ticketry_provider::{
    provider_contract, DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, Provider,
};

use crate::desktop::lifecycle::MAIN_WINDOW_LABEL;

#[tauri::command]
pub(crate) async fn desktop_prepare_directory_trust(
    window: tauri::WebviewWindow,
    provider: String,
    directory: String,
    approval: Option<String>,
) -> Result<DirectoryTrustResult, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("Directory trust setup is restricted to the local main window.".to_owned());
    }
    if !Path::new(&directory).is_absolute() {
        return Err("Select an existing folder with an absolute path and retry.".to_owned());
    }
    let provider = Provider::try_from(provider.as_str()).map_err(|error| error.message)?;
    tauri::async_runtime::spawn_blocking(move || {
        prepare_directory_trust(provider, Path::new(&directory), None, approval.as_deref())
    })
    .await
    .map_err(|error| format!("Directory trust setup stopped: {error}. Retry folder setup."))?
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(crate) struct DirectoryTrustResult {
    status: &'static str,
    approval: Option<String>,
}

fn prepare_directory_trust(
    provider: Provider,
    directory: &Path,
    trust_file: Option<&Path>,
    approval_token: Option<&str>,
) -> Result<DirectoryTrustResult, String> {
    let contract = provider_contract(provider);
    let context = DirectoryTrustContext {
        directory,
        trust_file,
    };
    match contract.inspect_directory_trust(context) {
        DirectoryTrustInspection::Trusted => Ok(outcome("already_trusted")),
        DirectoryTrustInspection::ApprovalRequired(approval) => {
            if !approval_token.is_some_and(|token| take_approval(token, &approval)) {
                return Ok(DirectoryTrustResult {
                    status: "approval_required",
                    approval: Some(store_approval(approval)),
                });
            }
            match contract.prepare_directory_trust(context, Some(&approval)) {
                DirectoryTrustPreparation::Prepared => Ok(outcome("prepared")),
                DirectoryTrustPreparation::AlreadyTrusted => Ok(outcome("already_trusted")),
                DirectoryTrustPreparation::ApprovalRequired => Ok(DirectoryTrustResult {
                    status: "approval_required",
                    approval: Some(store_approval(approval)),
                }),
                DirectoryTrustPreparation::Denied => Ok(outcome("denied")),
                DirectoryTrustPreparation::Unsupported => Ok(outcome("unsupported")),
                DirectoryTrustPreparation::Failed(failure) => Err(format!(
                    "Could not prepare directory trust for {}: {}",
                    provider.slug(),
                    failure.message
                )),
            }
        }
        DirectoryTrustInspection::Denied => Ok(outcome("denied")),
        DirectoryTrustInspection::Unsupported => Ok(outcome("unsupported")),
        DirectoryTrustInspection::Failed(failure) => Err(format!(
            "Could not inspect directory trust for {}: {}",
            provider.slug(),
            failure.message
        )),
    }
}

fn outcome(status: &'static str) -> DirectoryTrustResult {
    DirectoryTrustResult {
        status,
        approval: None,
    }
}

fn pending_approval() -> &'static Mutex<Option<(String, DirectoryTrustApproval)>> {
    // ponytail: one main-window confirmation can be pending; use a per-window map
    // if Ticketry ever allows concurrent trust dialogs.
    static PENDING: OnceLock<Mutex<Option<(String, DirectoryTrustApproval)>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn store_approval(approval: DirectoryTrustApproval) -> String {
    let handle = uuid::Uuid::new_v4().to_string();
    *pending_approval().lock().unwrap() = Some((handle.clone(), approval));
    handle
}

fn take_approval(handle: &str, approval: &DirectoryTrustApproval) -> bool {
    pending_approval()
        .lock()
        .unwrap()
        .take()
        .is_some_and(|(stored_handle, stored_approval)| {
            stored_handle == handle && stored_approval == *approval
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_provider_uses_shared_contract_without_writing() {
        let root = tempfile::tempdir().unwrap();
        let trust_file = root.path().join("trustedFolders.json");

        assert_eq!(
            prepare_directory_trust(Provider::Codex, root.path(), Some(&trust_file), None)
                .unwrap()
                .status,
            "unsupported"
        );
        assert!(!trust_file.exists());
    }

    #[test]
    fn approval_is_bound_to_the_inspected_provider_and_canonical_directory() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first");
        let second = root.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        let trust_file = root.path().join("trustedFolders.json");
        let inspected =
            prepare_directory_trust(Provider::Gemini, &first, Some(&trust_file), None).unwrap();

        assert_eq!(inspected.status, "approval_required");
        assert_eq!(
            prepare_directory_trust(
                Provider::Gemini,
                &second,
                Some(&trust_file),
                inspected.approval.as_deref(),
            )
            .unwrap()
            .status,
            "approval_required"
        );
        assert!(!trust_file.exists());
        assert_eq!(
            prepare_directory_trust(
                Provider::Gemini,
                &first,
                Some(&trust_file),
                inspected.approval.as_deref(),
            )
            .unwrap()
            .status,
            "approval_required"
        );
        assert!(!trust_file.exists());
        let reinspected =
            prepare_directory_trust(Provider::Gemini, &first, Some(&trust_file), Some("forged"))
                .unwrap();
        assert_eq!(reinspected.status, "approval_required");
        assert!(!trust_file.exists());
        assert_eq!(
            prepare_directory_trust(
                Provider::Gemini,
                &first,
                Some(&trust_file),
                reinspected.approval.as_deref(),
            )
            .unwrap()
            .status,
            "prepared"
        );
    }

    #[test]
    fn provider_failure_remains_an_error_with_provider_detail() {
        let root = tempfile::tempdir().unwrap();
        let trust_file = root.path().join("trustedFolders.json");
        std::fs::write(&trust_file, "{").unwrap();

        let error = prepare_directory_trust(Provider::Gemini, root.path(), Some(&trust_file), None)
            .unwrap_err();

        assert!(error.contains("inspect directory trust for gemini"));
        assert_eq!(std::fs::read_to_string(trust_file).unwrap(), "{");
    }
}
