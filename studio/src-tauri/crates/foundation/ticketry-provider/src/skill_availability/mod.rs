//! Whether a provider can see the skills a launch binding names.
//!
//! This is an observation of known locations, never an installer: it lists
//! directories and checks for `SKILL.md`, and it performs no filesystem write
//! and no network call. A skill is available only when an immediate child
//! directory of a provider-visible root matches the requested name (exactly,
//! or else ignoring case) and contains `SKILL.md`.

mod roots;
mod scan;

use std::path::PathBuf;

use crate::Provider;

/// Where the provider's user-level skill roots live on this machine.
///
/// Callers that observe the real host use [`SkillSearchEnvironment::from_process`];
/// tests pass a disposable home instead of mutating process variables.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SkillSearchEnvironment {
    pub home: Option<PathBuf>,
    /// `CLAUDE_CONFIG_DIR`, which replaces `~/.claude`.
    pub claude_config_dir: Option<PathBuf>,
    /// `CODEX_HOME`, which replaces `~/.codex`.
    pub codex_home: Option<PathBuf>,
    /// `GEMINI_CLI_HOME`, which replaces the home that holds `.gemini`.
    pub gemini_cli_home: Option<PathBuf>,
}

impl SkillSearchEnvironment {
    /// The current process's home and provider overrides. An empty variable is
    /// treated as unset, as the providers themselves do.
    #[must_use]
    pub fn from_process() -> Self {
        let variable = |name: &str| {
            std::env::var_os(name)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        };
        Self {
            home: std::env::home_dir(),
            claude_config_dir: variable("CLAUDE_CONFIG_DIR"),
            codex_home: variable("CODEX_HOME"),
            gemini_cli_home: variable("GEMINI_CLI_HOME"),
        }
    }
}

/// One availability question: which of `names` can `provider` see when it
/// runs in `working_root`?
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SkillAvailabilityRequest {
    pub provider: Provider,
    /// The folder the provider runs in; `None` searches user roots only.
    pub working_root: Option<PathBuf>,
    pub names: Vec<String>,
    pub environment: SkillSearchEnvironment,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SkillAvailabilityStatus {
    /// A matching directory containing `SKILL.md` was found.
    Available,
    /// Every searched root was read and none holds the skill.
    Missing,
    /// A root could not be read, so absence was not established.
    Unchecked { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SkillAvailability {
    /// The name exactly as the binding stores it.
    pub requested: String,
    pub status: SkillAvailabilityStatus,
    /// The matched directory's own spelling, when available.
    pub installed_name: Option<String>,
    /// The matched directory, when available.
    pub location: Option<PathBuf>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SkillAvailabilityReport {
    pub provider: Provider,
    /// Every root searched, in precedence order, whether or not it exists.
    pub searched_roots: Vec<PathBuf>,
    /// One entry per requested name, in request order.
    pub skills: Vec<SkillAvailability>,
}

/// Observe which requested skills the provider can see. Read-only.
#[must_use]
pub fn check_skill_availability(request: &SkillAvailabilityRequest) -> SkillAvailabilityReport {
    let searched_roots = roots::search_roots(
        request.provider,
        request.working_root.as_deref(),
        &request.environment,
    );
    let listings = searched_roots
        .iter()
        .map(|root| scan::list_skills(root))
        .collect::<Vec<_>>();
    let skills = request
        .names
        .iter()
        .map(|name| scan::resolve(name, &listings))
        .collect();
    SkillAvailabilityReport {
        provider: request.provider,
        searched_roots,
        skills,
    }
}
