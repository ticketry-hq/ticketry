use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::path::Path;

use chrono::{SecondsFormat, Utc};
use serde_json::{Map, Value};

use crate::persistence::{LifecycleFact, RunsPersistenceErrorCode};

use super::HookDiagnostic;

const FILE_VERSION: &str = "v1";
const PAYLOAD_VERSION: u64 = 1;

pub(super) struct ParsedFilename<'a> {
    pub(super) provider: &'a str,
    pub(super) agent_run_id: &'a str,
}

pub(super) fn parse_filename(path: &Path) -> Result<ParsedFilename<'_>, PrepareError> {
    let stem = path
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or_else(|| PrepareError::permanent(HookDiagnostic::InvalidFilename))?;
    let components = stem.split("__").collect::<Vec<_>>();
    if components.len() != 4 || components[0] != FILE_VERSION {
        let diagnostic = if components
            .first()
            .is_some_and(|value| value.starts_with('v'))
        {
            HookDiagnostic::UnsupportedFilenameVersion
        } else {
            HookDiagnostic::InvalidFilename
        };
        return Err(PrepareError::permanent(diagnostic));
    }
    let [_, provider, agent_run_id, nonce] = components.as_slice() else {
        unreachable!()
    };
    if !safe_component(provider) || !safe_component(agent_run_id) || !safe_component(nonce) {
        return Err(PrepareError::permanent(HookDiagnostic::InvalidFilename));
    }
    if !matches!(*provider, "agy" | "claude" | "codex" | "gemini") {
        return Err(PrepareError::permanent(HookDiagnostic::UnknownProvider));
    }
    Ok(ParsedFilename {
        provider,
        agent_run_id,
    })
}

fn safe_component(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(super) fn open_regular_file(path: &Path) -> Result<File, PrepareError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(path)
        .map_err(|_| PrepareError::transient(HookDiagnostic::SpoolUnavailable))?;
    if !file
        .metadata()
        .map_err(|_| PrepareError::transient(HookDiagnostic::SpoolUnavailable))?
        .is_file()
    {
        return Err(PrepareError::permanent(HookDiagnostic::UnsafeFileType));
    }
    Ok(file)
}

pub(super) fn validate_payload_version(object: &Map<String, Value>) -> Result<(), PrepareError> {
    let Some(version) = object.get("ticketry_hook_version") else {
        // Provider payloads written before the explicit marker are v1.
        return Ok(());
    };
    if version.as_u64() == Some(PAYLOAD_VERSION) {
        Ok(())
    } else {
        Err(PrepareError::permanent(
            HookDiagnostic::UnsupportedPayloadVersion,
        ))
    }
}

pub(super) fn map_provider_event(
    provider: &str,
    agent_run_id: &str,
    object: &Map<String, Value>,
) -> Result<Option<LifecycleFact>, PrepareError> {
    let event = object
        .get("hook_event_name")
        .and_then(Value::as_str)
        .ok_or_else(|| PrepareError::permanent(HookDiagnostic::InvalidPayload))?;
    let kind = match (provider, event) {
        ("claude", "SessionStart")
        | ("codex", "SessionStart")
        | ("gemini", "SessionStart")
        | ("agy", "SessionStart") => "session_start",
        ("claude", "UserPromptSubmit")
        | ("codex", "UserPromptSubmit")
        | ("gemini", "BeforeAgent") => "turn_start",
        ("claude", "PreToolUse" | "PostToolUse")
        | ("codex", "PreToolUse" | "PostToolUse")
        | ("gemini", "BeforeTool" | "AfterTool")
        | ("agy", "PreToolUse" | "PostToolUse") => "tool_use",
        ("claude", "Notification" | "PermissionRequest")
        | ("gemini", "Notification")
        | ("agy", "Notification")
        | ("codex", "Stop") => "awaiting_input",
        ("codex", "PermissionRequest") => "permission_required",
        ("claude", "Stop") | ("gemini", "AfterAgent") | ("agy", "Stop") => "turn_complete",
        ("claude", "SessionEnd") | ("gemini", "SessionEnd") | ("agy", "SessionEnd") => {
            "session_end"
        }
        _ => return Ok(None),
    };
    let session_keys: &[&str] = if provider == "agy" {
        &["conversationId", "conversation_id"]
    } else {
        &["session_id"]
    };
    let provider_session_id = session_keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    });
    Ok(Some(LifecycleFact {
        agent_run_id: agent_run_id.to_owned(),
        kind: kind.to_owned(),
        occurred_at: Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
        provider_session_id,
    }))
}

pub(super) fn permanent_reducer_error(code: RunsPersistenceErrorCode) -> bool {
    matches!(
        code,
        RunsPersistenceErrorCode::InvalidLifecycleFact
            | RunsPersistenceErrorCode::InvalidProviderSession
            | RunsPersistenceErrorCode::InvalidTimestamp
    )
}

#[derive(Debug)]
pub(super) enum PrepareError {
    Permanent(HookDiagnostic),
    Transient(HookDiagnostic),
}

impl PrepareError {
    pub(super) fn permanent(diagnostic: HookDiagnostic) -> Self {
        Self::Permanent(diagnostic)
    }

    pub(super) fn transient(diagnostic: HookDiagnostic) -> Self {
        Self::Transient(diagnostic)
    }
}
