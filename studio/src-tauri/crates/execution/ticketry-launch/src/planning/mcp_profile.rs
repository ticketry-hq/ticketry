//! Apply the trusted profile after the provider validates the user's selection.
//! Its separate configuration layer resets Ticketry's inherited MCP entry;
//! the CLI override then supplies the canonical credentialed stdio server.

use super::{DurableLaunchMaterial, LaunchKind, Provider};

pub(super) fn apply(
    durable: &DurableLaunchMaterial,
    prepared_profile: Option<&str>,
    argv: &mut Vec<String>,
) {
    let Some(profile) = prepared_profile.filter(|_| durable.provider == Provider::Codex) else {
        return;
    };
    // Only a selected user profile introduces this option. A prompt, model,
    // or resume identity can otherwise contain the same string as ordinary data.
    if durable.options.profile.is_some() {
        if let Some(index) = argv.iter().position(|argument| argument == "--profile") {
            argv[index + 1] = profile.to_owned();
            return;
        }
    }
    let offset = usize::from(matches!(durable.kind, LaunchKind::Resume { .. }));
    argv.splice(1 + offset..1 + offset, ["--profile".into(), profile.into()]);
}
