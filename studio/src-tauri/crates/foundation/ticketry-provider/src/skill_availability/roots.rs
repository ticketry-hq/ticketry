//! The provider-visible skill roots, in precedence order.

use std::path::{Path, PathBuf};

use super::SkillSearchEnvironment;
use crate::Provider;

/// Working-directory roots first, then the user root. Another provider's roots
/// are never searched as a fallback.
pub(super) fn search_roots(
    provider: Provider,
    working_root: Option<&Path>,
    environment: &SkillSearchEnvironment,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(working_root) = working_root {
        roots.extend(
            working_relative(provider)
                .iter()
                .map(|relative| working_root.join(relative)),
        );
    }
    if let Some(user_root) = user_root(provider, environment) {
        // Codex ships its bundled skills one level down, in `.system`.
        let system = (provider == Provider::Codex).then(|| user_root.join(".system"));
        roots.push(user_root);
        roots.extend(system);
    }
    roots
}

fn working_relative(provider: Provider) -> &'static [&'static str] {
    match provider {
        Provider::Claude => &[".claude/skills"],
        Provider::Codex | Provider::Agy => &[".agents/skills", "skills"],
        Provider::Gemini => &[".gemini/skills"],
    }
}

fn user_root(provider: Provider, environment: &SkillSearchEnvironment) -> Option<PathBuf> {
    let home = environment.home.as_deref();
    let base = |configured: &Option<PathBuf>, default: &str| {
        configured
            .clone()
            .or_else(|| home.map(|home| home.join(default)))
    };
    let base = match provider {
        Provider::Claude => base(&environment.claude_config_dir, ".claude"),
        Provider::Codex => base(&environment.codex_home, ".codex"),
        Provider::Agy => base(&None, ".agy"),
        Provider::Gemini => environment
            .gemini_cli_home
            .clone()
            .or_else(|| home.map(Path::to_path_buf))
            .map(|home| home.join(".gemini")),
    };
    base.map(|base| base.join("skills"))
}
