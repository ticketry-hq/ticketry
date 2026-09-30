//! Explicit provider folder approval from the local main webview.
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde::Serialize;
use ticketry_provider::{
    provider_contract, DirectoryTrustApproval, DirectoryTrustContext, DirectoryTrustInspection,
    DirectoryTrustPreparation, Provider,
};
use ticketry_tool_discovery::{discover_tool, SupportedTool};

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
    directory: String,
}

fn prepare_directory_trust(
    provider: Provider,
    directory: &Path,
    trust_file: Option<&Path>,
    approval_token: Option<&str>,
) -> Result<DirectoryTrustResult, String> {
    let directory = directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve directory trust target: {error}"))?;
    if !directory.is_dir() {
        return Err("Directory trust requires an existing folder.".to_owned());
    }
    let directory_text = directory
        .to_str()
        .ok_or_else(|| "Directory trust requires a UTF-8 folder path.".to_owned())?
        .to_owned();
    let contract = provider_contract(provider);
    let executable = (provider == Provider::Claude)
        .then(|| discover_tool(SupportedTool::Claude))
        .and_then(|diagnostic| diagnostic.path.map(PathBuf::from));
    let context = DirectoryTrustContext {
        directory: &directory,
        trust_file,
        executable: executable.as_deref(),
    };
    match contract.inspect_directory_trust(context) {
        DirectoryTrustInspection::Trusted => Ok(outcome("already_trusted", directory_text)),
        DirectoryTrustInspection::ApprovalRequired(approval) => {
            if !approval_token.is_some_and(|token| take_approval(token, &approval)) {
                return Ok(DirectoryTrustResult {
                    status: "approval_required",
                    approval: Some(store_approval(approval)),
                    directory: directory_text,
                });
            }
            match contract.prepare_directory_trust(context, Some(&approval)) {
                DirectoryTrustPreparation::Prepared => Ok(outcome("prepared", directory_text)),
                DirectoryTrustPreparation::AlreadyTrusted => {
                    Ok(outcome("already_trusted", directory_text))
                }
                DirectoryTrustPreparation::ApprovalRequired => Ok(DirectoryTrustResult {
                    status: "approval_required",
                    approval: Some(store_approval(approval)),
                    directory: directory_text,
                }),
                DirectoryTrustPreparation::Denied => Ok(outcome("denied", directory_text)),
                DirectoryTrustPreparation::Unsupported => {
                    Ok(outcome("unsupported", directory_text))
                }
                DirectoryTrustPreparation::Failed(failure) => Err(format!(
                    "Could not prepare directory trust for {}: {}",
                    provider.slug(),
                    failure.message
                )),
            }
        }
        DirectoryTrustInspection::Denied => Ok(outcome("denied", directory_text)),
        DirectoryTrustInspection::Unsupported => Ok(outcome("unsupported", directory_text)),
        DirectoryTrustInspection::Failed(failure) => Err(format!(
            "Could not inspect directory trust for {}: {}",
            provider.slug(),
            failure.message
        )),
    }
}

fn outcome(status: &'static str, directory: String) -> DirectoryTrustResult {
    DirectoryTrustResult {
        status,
        approval: None,
        directory,
    }
}

fn pending_approvals() -> &'static Mutex<Vec<(String, DirectoryTrustApproval)>> {
    static PENDING: OnceLock<Mutex<Vec<(String, DirectoryTrustApproval)>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

fn store_approval(approval: DirectoryTrustApproval) -> String {
    let handle = uuid::Uuid::new_v4().to_string();
    let mut pending = pending_approvals().lock().unwrap();
    if pending.len() == 8 {
        pending.remove(0);
    }
    pending.push((handle.clone(), approval));
    handle
}

fn take_approval(handle: &str, approval: &DirectoryTrustApproval) -> bool {
    let mut pending = pending_approvals().lock().unwrap();
    let Some(index) = pending
        .iter()
        .position(|(stored_handle, _)| stored_handle == handle)
    else {
        return false;
    };
    pending.remove(index).1 == *approval
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_uses_shared_approval_without_writing_before_consent() {
        let root = tempfile::tempdir().unwrap();
        let trust_file = root.path().join(".claude.json");

        let inspected =
            prepare_directory_trust(Provider::Claude, root.path(), Some(&trust_file), None)
                .unwrap();
        assert_eq!(inspected.status, "approval_required");
        assert!(!trust_file.exists());
        assert_eq!(
            prepare_directory_trust(
                Provider::Claude,
                root.path(),
                Some(&trust_file),
                inspected.approval.as_deref(),
            )
            .unwrap()
            .status,
            "prepared"
        );
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
        assert_eq!(inspected.directory, first.canonicalize().unwrap());
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

    #[test]
    fn provider_approvals_can_remain_pending_for_one_shared_consent() {
        let root = tempfile::tempdir().unwrap();
        let gemini_file = root.path().join("gemini.json");
        let codex_file = root.path().join("config.toml");
        let claude_file = root.path().join(".claude.json");
        let gemini =
            prepare_directory_trust(Provider::Gemini, root.path(), Some(&gemini_file), None)
                .unwrap();
        let codex =
            prepare_directory_trust(Provider::Codex, root.path(), Some(&codex_file), None).unwrap();
        let claude =
            prepare_directory_trust(Provider::Claude, root.path(), Some(&claude_file), None)
                .unwrap();

        assert_eq!(gemini.status, "approval_required");
        assert_eq!(codex.status, "approval_required");
        assert_eq!(claude.status, "approval_required");
        assert_eq!(
            prepare_directory_trust(
                Provider::Gemini,
                root.path(),
                Some(&gemini_file),
                gemini.approval.as_deref(),
            )
            .unwrap()
            .status,
            "prepared"
        );
        assert_eq!(
            prepare_directory_trust(
                Provider::Codex,
                root.path(),
                Some(&codex_file),
                codex.approval.as_deref(),
            )
            .unwrap()
            .status,
            "prepared"
        );
        assert_eq!(
            prepare_directory_trust(
                Provider::Claude,
                root.path(),
                Some(&claude_file),
                claude.approval.as_deref(),
            )
            .unwrap()
            .status,
            "prepared"
        );
    }
}
