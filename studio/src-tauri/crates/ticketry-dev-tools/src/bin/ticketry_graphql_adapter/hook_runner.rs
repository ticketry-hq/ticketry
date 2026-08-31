//! Adapter-only hook runner discovery for browser development.
//!
//! The desktop shell locates `ticketry-hook` beside its packaged executable.
//! This development adapter has no Tauri application handle, so it resolves
//! the same helper from an explicit environment override first and falls back
//! to an executable sibling probe, failing with an actionable message.

use std::env;
use std::path::{Path, PathBuf};

const HOOK_RUNNER_BINARY: &str = "ticketry-hook";
pub(crate) const HOOK_RUNNER_ENV: &str = "TICKETRY_GRAPHQL_ADAPTER_HOOK_RUNNER";

#[derive(Debug, Default)]
pub(crate) struct HookRunnerResolver {
    override_value: Option<String>,
    sibling_directory: Option<PathBuf>,
}

impl HookRunnerResolver {
    pub(crate) fn from_environment() -> Self {
        Self {
            override_value: env::var(HOOK_RUNNER_ENV)
                .ok()
                .filter(|value| !value.trim().is_empty()),
            sibling_directory: env::current_exe()
                .ok()
                .and_then(|executable| executable.parent().map(Path::to_path_buf)),
        }
    }

    /// The resolved hook runner executable, or one actionable error that names
    /// every way to fix the misconfiguration. Launch planning hands the path
    /// straight to agent environments, so the result is always an absolute,
    /// canonical file path (symlinks and `.`/`..` components resolved).
    pub(crate) fn resolve(&self) -> Result<PathBuf, String> {
        let binary_name = format!("{HOOK_RUNNER_BINARY}{}", env::consts::EXE_SUFFIX);
        if let Some(value) = &self.override_value {
            let candidate = PathBuf::from(value);
            return candidate
                .canonicalize()
                .ok()
                .filter(|path| path.is_file())
                .ok_or_else(|| {
                    format!(
                        "{HOOK_RUNNER_ENV} points at {value:?}, which does not resolve to a \
                         hook runner file. Point it at a built ticketry-hook executable."
                    )
                });
        }
        if let Some(directory) = &self.sibling_directory {
            let candidate = directory.join(&binary_name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        Err(format!(
            "browser development cannot locate the {HOOK_RUNNER_BINARY} hook runner. \
             Build it (for example with the desktop acceptance driver) and set \
             {HOOK_RUNNER_ENV} to its absolute path, or place {binary_name} beside \
             this adapter binary."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_override_wins_and_must_be_a_file() {
        let directory = tempfile::tempdir().expect("create resolver test directory");
        let runner = directory.path().join("custom-hook");
        std::fs::write(&runner, b"hook").expect("write fake hook runner");

        let resolver = HookRunnerResolver {
            override_value: Some(runner.display().to_string()),
            sibling_directory: Some(PathBuf::from("/nonexistent")),
        };
        let resolved = resolver.resolve().expect("resolved");
        assert!(resolved.is_absolute());
        assert!(resolved.is_file());
        assert_eq!(
            resolved,
            runner.canonicalize().expect("canonical reference"),
            "the override must canonicalize to the real file path"
        );

        let missing = HookRunnerResolver {
            override_value: Some("/definitely/not/here".to_owned()),
            sibling_directory: None,
        };
        let error = missing.resolve().expect_err("missing file must fail");
        assert!(error.contains(HOOK_RUNNER_ENV));
    }

    #[test]
    fn sibling_probe_uses_the_platform_executable_suffix() {
        let directory = tempfile::tempdir().expect("create sibling test directory");
        let runner = directory
            .path()
            .join(format!("{HOOK_RUNNER_BINARY}{}", env::consts::EXE_SUFFIX));
        std::fs::write(&runner, b"hook").expect("write fake hook runner");

        let resolver = HookRunnerResolver {
            override_value: None,
            sibling_directory: Some(directory.path().to_path_buf()),
        };
        assert_eq!(resolver.resolve().expect("resolved"), runner);
    }

    #[test]
    fn unresolvable_discovery_names_the_env_override() {
        let resolver = HookRunnerResolver {
            override_value: None,
            sibling_directory: Some(PathBuf::from("/nonexistent")),
        };
        let error = resolver.resolve().expect_err("nothing to discover");
        assert!(
            error.contains(HOOK_RUNNER_ENV),
            "error must name the override variable: {error}"
        );
    }

    #[test]
    fn blank_overrides_are_treated_as_unset() {
        let resolver = HookRunnerResolver {
            override_value: Some("   ".to_owned()),
            sibling_directory: None,
        };
        assert!(resolver.resolve().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn overrides_resolve_to_absolute_canonical_files() {
        use std::os::unix::fs::symlink;

        // Launch planning needs an absolute canonical path, so a relative or
        // symlink-laden override must resolve to the real file. macOS temp
        // dirs already contain a /var -> /private/var symlink, which makes the
        // canonicalization observable even for absolute inputs.
        let directory = tempfile::tempdir().expect("create canonicalization test directory");
        let link = directory.path().join("hook-link");
        symlink("real-hook", &link).expect("create hook runner symlink");
        std::fs::write(directory.path().join("real-hook"), b"hook")
            .expect("write fake hook runner");

        let messy = format!("{}/./hook-link/../hook-link", directory.path().display());
        let resolver = HookRunnerResolver {
            override_value: Some(messy),
            sibling_directory: None,
        };
        let resolved = resolver
            .resolve()
            .expect("resolved through symlink and dot components");

        assert!(resolved.is_absolute());
        assert!(resolved.is_file());
        assert_eq!(
            resolved,
            std::fs::canonicalize(link).expect("canonical reference"),
            "the resolved path must be the canonical file, not the raw override"
        );
    }

    #[cfg(unix)]
    #[test]
    fn broken_symlink_overrides_are_rejected_with_the_variable_named() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("create dangling symlink test directory");
        let dangling = directory.path().join("dangling-hook");
        symlink("missing-target", &dangling).expect("create dangling symlink");

        let resolver = HookRunnerResolver {
            override_value: Some(dangling.display().to_string()),
            sibling_directory: None,
        };
        let error = resolver.resolve().expect_err("dangling file must fail");
        assert!(error.contains(HOOK_RUNNER_ENV), "{error}");
    }
}
