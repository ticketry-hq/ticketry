//! What the recovery log is allowed to remember.
//!
//! The journal survives crashes, is read by operators, and is replayed by
//! reconciliation. That makes it exactly the wrong place for a file body, a
//! prompt, a credential, an environment value, a command line, or a
//! caller-selected absolute path — a durable copy of any of those turns the
//! recovery log into a secret store or an execution surface.
//!
//! Two rules apply, by provenance. Immutable intent comes from a caller and is
//! **rejected** outright when it carries anything on that list, because a
//! refused request is safe and a half-trusted one is not. Evidence and result
//! summaries come from a probe or executor after the fact; they are
//! **redacted** so a careless observation still leaves usable recovery
//! evidence instead of failing the settlement that must be durable.

use serde_json::{Map, Value};

use super::WorkspaceOperationError;

/// Key fragments that name something the journal never persists. Matching is
/// done on the key with separators removed, so `api_key`, `apiKey`, and
/// `API-KEY` are one rule.
const FORBIDDEN_KEY_FRAGMENTS: &[&str] = &[
    "apikey",
    "argv",
    "auth",
    "body",
    "command",
    "content",
    "cookie",
    "credential",
    "env",
    "header",
    "password",
    "prompt",
    "script",
    "secret",
    "shell",
    "token",
];

/// The redaction marker written in place of a forbidden or unusable value.
pub const REDACTED: &str = "[redacted]";

const MAX_KEYS: usize = 32;
const MAX_KEY_LENGTH: usize = 64;
const MAX_STRING_LENGTH: usize = 500;
const MAX_ARRAY_LENGTH: usize = 32;
const MAX_DEPTH: usize = 3;

/// Validate one caller-supplied intent payload. The payload must be a bounded
/// object of scalars, and every key and value must survive the rules above.
pub fn validate_payload(payload: &Value) -> Result<(), WorkspaceOperationError> {
    let Value::Object(entries) = payload else {
        return Err(WorkspaceOperationError::forbidden(
            "A Workspace Operation intent payload must be an object.",
        ));
    };
    validate_object(entries, 1)
}

fn validate_object(
    entries: &Map<String, Value>,
    depth: usize,
) -> Result<(), WorkspaceOperationError> {
    if depth > MAX_DEPTH {
        return Err(WorkspaceOperationError::forbidden(
            "The Workspace Operation intent payload is nested too deeply.",
        ));
    }
    if entries.len() > MAX_KEYS {
        return Err(WorkspaceOperationError::forbidden(
            "The Workspace Operation intent payload has too many fields.",
        ));
    }
    for (key, value) in entries {
        if !usable_key(key) {
            return Err(WorkspaceOperationError::forbidden(format!(
                "The Workspace Operation intent field '{}' is not a usable name.",
                bounded_label(key)
            )));
        }
        if forbidden_key(key) {
            return Err(WorkspaceOperationError::forbidden(format!(
                "The Workspace Operation intent field '{}' names content the journal never persists.",
                bounded_label(key)
            )));
        }
        validate_value(value, depth)?;
    }
    Ok(())
}

fn validate_value(value: &Value, depth: usize) -> Result<(), WorkspaceOperationError> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
        Value::String(text) => usable_string(text).map(|_| ()).ok_or_else(|| {
            WorkspaceOperationError::forbidden(
                "A Workspace Operation intent value is unbounded, control-bearing, or an absolute or traversing path.",
            )
        }),
        Value::Array(items) => {
            if items.len() > MAX_ARRAY_LENGTH {
                return Err(WorkspaceOperationError::forbidden(
                    "A Workspace Operation intent list is too long.",
                ));
            }
            items.iter().try_for_each(|item| validate_value(item, depth + 1))
        }
        Value::Object(entries) => validate_object(entries, depth + 1),
    }
}

/// Redact one probe or executor observation. The shape is preserved so
/// reconciliation still has evidence to compare; anything unusable becomes the
/// redaction marker rather than a durable leak.
pub fn redact(value: &Value) -> Value {
    redact_at(value, 1)
}

fn redact_at(value: &Value, depth: usize) -> Value {
    if depth > MAX_DEPTH {
        return Value::String(REDACTED.to_owned());
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
        Value::String(text) => {
            Value::String(usable_string(text).unwrap_or_else(|| REDACTED.to_owned()))
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .take(MAX_ARRAY_LENGTH)
                .map(|item| redact_at(item, depth + 1))
                .collect(),
        ),
        Value::Object(entries) => Value::Object(
            entries
                .iter()
                .take(MAX_KEYS)
                .map(|(key, value)| {
                    let key = if usable_key(key) {
                        key.clone()
                    } else {
                        bounded_label(key)
                    };
                    if forbidden_key(&key) {
                        (key, Value::String(REDACTED.to_owned()))
                    } else {
                        (key, redact_at(value, depth + 1))
                    }
                })
                .collect(),
        ),
    }
}

/// Bound one free-text diagnostic. `None` means the text cannot be persisted
/// at all, so the caller substitutes its own typed description.
pub fn bounded_detail(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= MAX_STRING_LENGTH && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}

/// Bound and redact one free-text diagnostic that will be stored. Git and
/// filesystem failures legitimately mention the thing that failed, so the
/// message survives with any absolute-path-looking token replaced, rather than
/// being thrown away and losing the reason.
pub fn redact_text(value: &str, limit: usize) -> String {
    let redacted = value
        .split_whitespace()
        .map(|token| {
            let trimmed = token.trim_matches(|character: char| {
                matches!(character, '\'' | '"' | '(' | ')' | ',' | ';' | ':')
            });
            if absolute_path(trimmed) {
                REDACTED
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let redacted = redacted
        .chars()
        .filter(|character| !character.is_control())
        .take(limit)
        .collect::<String>();
    if redacted.trim().is_empty() {
        REDACTED.to_owned()
    } else {
        redacted
    }
}

/// A resource key identifies the subject a kind acts on. It is a canonical
/// relative identity — never a caller-selected absolute path.
pub fn usable_resource_key(value: &str) -> Option<String> {
    usable_string(value)
}

fn usable_string(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_STRING_LENGTH {
        return None;
    }
    if value.chars().any(char::is_control) {
        return None;
    }
    (!absolute_path(value) && !traverses(value)).then(|| value.to_owned())
}

/// Absolute POSIX paths, home-relative paths, UNC paths, and Windows drive
/// paths. None of them may be stored, because reconciliation re-resolves every
/// subject against the currently authorized roots instead.
fn absolute_path(value: &str) -> bool {
    if value.starts_with('/') || value.starts_with('~') || value.starts_with("\\\\") {
        return true;
    }
    let mut characters = value.chars();
    matches!(
        (characters.next(), characters.next(), characters.next()),
        (Some(drive), Some(':'), Some('/' | '\\')) if drive.is_ascii_alphabetic()
    )
}

fn traverses(value: &str) -> bool {
    value.contains("..")
}

fn usable_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_KEY_LENGTH
        && key.starts_with(|character: char| character.is_ascii_alphabetic())
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn forbidden_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase();
    FORBIDDEN_KEY_FRAGMENTS
        .iter()
        .any(|fragment| normalized.contains(fragment))
}

fn bounded_label(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '_')
        .take(MAX_KEY_LENGTH)
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn intent_payloads_reject_the_things_a_recovery_log_must_never_hold() {
        for payload in [
            json!({ "body": "# the whole document" }),
            json!({ "systemPrompt": "you are" }),
            json!({ "accessToken": "abc" }),
            json!({ "apiKey": "abc" }),
            json!({ "environment": { "HOME": "/Users/someone" } }),
            json!({ "command": "git worktree add" }),
            json!({ "argv": ["git", "push"] }),
            json!({ "documentPath": "/Users/someone/notes.md" }),
            json!({ "documentPath": "~/notes.md" }),
            json!({ "documentPath": "C:\\Users\\someone\\notes.md" }),
            json!({ "relativePath": "spec/../../etc/passwd" }),
            json!({ "note": "line\u{7}break" }),
        ] {
            let error = validate_payload(&payload).unwrap_err();
            assert_eq!(
                error.code(),
                super::super::WorkspaceOperationErrorCode::ForbiddenPayload,
                "{payload}"
            );
        }
    }

    #[test]
    fn intent_payloads_accept_derived_relative_identities_and_digests() {
        assert!(validate_payload(&json!({
            "documentId": "3f2c",
            "relativePath": "spec/rusting--cf2de16d/SPEC.md",
            "expectedDigest": "a".repeat(64),
            "intendedDigest": "b".repeat(64),
            "stagingName": "SPEC.md.ticketry-op-3f2c.staging",
            "branch": "task/coding-756",
        }))
        .is_ok());
    }

    #[test]
    fn a_diagnostic_keeps_its_reason_and_loses_its_local_paths() {
        let message = redact_text(
            "fatal: '/Users/someone/checkout' already exists, aborting",
            2000,
        );
        assert!(message.contains("already exists"));
        assert!(message.contains(REDACTED));
        assert!(!message.contains("/Users/someone"));
        assert_eq!(redact_text("   ", 2000), REDACTED);
    }

    #[test]
    fn evidence_is_redacted_in_place_rather_than_rejected() {
        let redacted = redact(&json!({
            "branch": "task/coding-756",
            "gitCommand": "git worktree add /Users/someone/checkout",
            "checkoutPath": "/Users/someone/checkout",
            "ahead": 2,
        }));
        assert_eq!(redacted["branch"], json!("task/coding-756"));
        assert_eq!(redacted["ahead"], json!(2));
        assert_eq!(redacted["gitCommand"], json!(REDACTED));
        assert_eq!(redacted["checkoutPath"], json!(REDACTED));
    }
}
