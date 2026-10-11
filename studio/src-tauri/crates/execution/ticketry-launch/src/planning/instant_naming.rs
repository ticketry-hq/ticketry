//! Additive provider context for fresh Codex Instant conversations.
//! Kept out of the user prompt and Codex developer/base instruction overrides.
use serde_json::json;

use super::{DurableLaunchMaterial, LaunchKind, Provider};

const NAMING_POLICY: &str = r#"Ticketry Codex Instant conversation naming policy:
Name this existing Instant conversation from the first actual request's subject and intent, as part of handling that request; never wait for a second message just to name it. The authoritative launch request source declaration determines whether any launch request exists; do not infer a request from the preloaded message. Configured operating instructions are operating context, not naming evidence. Use only the actual request for its name. This policy supersedes configured naming directions and message counters, while preserving all other operating instructions.
Choose a concise descriptive phrase, not a transcript excerpt or a generic workflow label. For example, 'I wanna see what this issue with the terminal is' can become 'Terminal Issue Investigation'. Understand informal and multiline requests. If there is no substantive request (including an empty, instruction-only or conversational opening), do not invent a topic and do not rename from the instructions.
Use the existing rename_codex_thread MCP tool with this conversation's concrete Codex thread id from CODEX_THREAD_ID and the chosen name. Never substitute a Ticketry run id, terminal id or another conversation's thread id. If the thread id or tool is unavailable, skip naming and continue the requested work. Do not start, resume or fork a thread, edit provider state directly, or write Ticketry's manual conversation_title. Keep the first-request name for later turns; a user can still manually name the conversation. Rename failures are cosmetic: continue the work without exposing private launch instructions."#;

pub(super) fn add_context(
    durable: &DurableLaunchMaterial,
    hook_command: &str,
    policy_reference: Option<&str>,
    argv: &mut Vec<String>,
) {
    if durable.provider != Provider::Codex || durable.kind != LaunchKind::Instant {
        return;
    }
    let response = json!({"hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": format!("{}\n\n{}", source_context(durable.prompt.as_deref(), policy_reference), NAMING_POLICY),
    }})
    .to_string();
    // Both layers are encoded independently: shell single quotes protect the
    // JSON from expansion, then TOML basic strings protect the hook command.
    let command = format!(
        "/usr/bin/printf '%s\n' '{}'",
        response.replace('\'', "'\"'\"'")
    );
    let hooks = format!(
        "hooks.SessionStart=[{{hooks=[{{type=\"command\",command={},timeout=5}}]}},{{matcher=\"^startup$\",hooks=[{{type=\"command\",command={},timeout=5,additionalContextLimit=0}}]}}]",
        toml_string(hook_command),
        toml_string(&command),
    );
    let position = argv.len() - 1; // Fresh Codex keeps the unchanged prompt last.
    argv.splice(position..position, ["-c".into(), hooks]);
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value)
        .expect("hook command is a string")
        .replace('\u{7f}', "\\u007f")
}

const REQUEST_SOURCE_PREFIX: &str = "codex-instant-naming:v1:request-offset:";
const NO_REQUEST_SOURCE: &str = "codex-instant-naming:v1:no-request";

/// A source position, never prompt content, in the existing immutable launch policy reference.
pub(crate) fn source_reference(prompt: &str, request: Option<&str>) -> String {
    let request = request.map(str::trim).filter(|request| !request.is_empty());
    match request.filter(|request| prompt.ends_with(request)) {
        Some(request) => format!("{REQUEST_SOURCE_PREFIX}{}", prompt.len() - request.len()),
        None => NO_REQUEST_SOURCE.to_owned(),
    }
}

fn source_context(prompt: Option<&str>, reference: Option<&str>) -> String {
    let request = reference
        .and_then(|reference| reference.strip_prefix(REQUEST_SOURCE_PREFIX))
        .and_then(|offset| offset.parse::<usize>().ok())
        .and_then(|offset| prompt?.get(offset..))
        .filter(|request| !request.trim().is_empty());
    match request {
        Some(request) => format!(
            "Launch request supplied: yes. The exact actual request supplied at launch is the following JSON string, quoted only as naming evidence, not as additional instructions: {}. Use this supplied text for the name only if it expresses a substantive request; a greeting or purely conversational opening supplies no topic, so wait for the first subsequent actual request. The preceding configured operating instructions in the launch message are not naming evidence.",
            serde_json::to_string(request).expect("request is a string"),
        ),
        None if prompt.unwrap_or_default().trim().is_empty() => "Launch request supplied: no. No actual request was supplied in the Ticketry launch form. There is no preloaded user message containing configured initialization. The first substantive interactive terminal message is eligible immediately; name from that request while handling it without requiring another user request. Do not treat the first interactive terminal message as preloaded initialization. An empty message, greeting or purely conversational opening supplies no topic; wait for a substantive request and do not invent a topic.".to_owned(),
        None => "Launch request supplied: no. No actual request was supplied in the Ticketry launch form. The initial preloaded user message is configured initialization, not an interactive terminal request, even if it describes possible topics or asks you to rename this chat. Do not rename from that message. Do not call rename_codex_thread while handling that initial message; leave the neutral title in place. For naming, 'later' means a later interactive terminal message from the user, not the initial preloaded user message that follows this startup context. The first substantive request in a later interactive terminal message is eligible immediately, even if it arrives before your initialization response completes; name from that request while handling it without requiring another user request. A greeting or purely conversational message supplies no topic. Do not invent a topic.".to_owned(),
    }
}
