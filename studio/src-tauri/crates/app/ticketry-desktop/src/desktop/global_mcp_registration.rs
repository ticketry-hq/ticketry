//! One detached, process-local registration step for installed provider MCP servers.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ticketry_provider::{
    register_claude_global_mcp, register_codex_global_mcp, GlobalMcpRegistrationContext,
    GlobalMcpRegistrationOutcome,
};
use ticketry_tool_discovery::{discover_tool, SupportedTool};

const DATA_DIRECTORY_OVERRIDES: [&str; 4] = [
    "TICKETRY_DATA_DIR",
    "TICKETRY_PRODUCT_DATA_DIR",
    "MUXED_DATA_DIR",
    "TICKETRY_DATA_DIR_NAME",
];

#[derive(Clone)]
pub(crate) struct GlobalMcpStartupContext {
    hook_runner: PathBuf,
    data_directory: PathBuf,
    claude_config_file: Option<PathBuf>,
    claude_executable: Option<PathBuf>,
    codex_config_file: Option<PathBuf>,
    codex_executable: Option<PathBuf>,
    packaged_app: bool,
    development_build: bool,
    data_directory_overrides: [bool; 4],
}

impl GlobalMcpStartupContext {
    pub(crate) fn for_desktop(hook_runner: PathBuf, data_directory: PathBuf) -> Self {
        Self {
            hook_runner,
            data_directory,
            claude_config_file: None,
            claude_executable: None,
            codex_config_file: None,
            codex_executable: None,
            packaged_app: installed_packaged_app(),
            development_build: cfg!(debug_assertions),
            data_directory_overrides: DATA_DIRECTORY_OVERRIDES
                .map(|name| std::env::var_os(name).is_some()),
        }
    }
}

fn installed_packaged_app() -> bool {
    #[cfg(target_os = "macos")]
    {
        let Ok(executable) = std::env::current_exe() else {
            return false;
        };
        let Some(macos) = executable.parent() else {
            return false;
        };
        let Some(contents) = macos.parent() else {
            return false;
        };
        let Some(bundle) = contents.parent() else {
            return false;
        };
        macos.file_name().is_some_and(|name| name == "MacOS")
            && contents.file_name().is_some_and(|name| name == "Contents")
            && bundle
                .extension()
                .is_some_and(|extension| extension == "app")
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Tauri patches this metadata while bundling; raw Cargo release builds
        // have no bundle type and must not edit the user's provider state.
        tauri::utils::platform::bundle_type().is_some()
    }
}

/// Finite trace fields: arbitrary provider diagnostics and config values cannot leak.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct GlobalMcpStartupEvent {
    pub(crate) provider: &'static str,
    pub(crate) outcome: &'static str,
    pub(crate) reason: Option<&'static str>,
}

/// Retained as Tauri state so service retries cannot repeat provider registration.
#[derive(Default)]
pub(crate) struct GlobalMcpStartupRegistration {
    started: AtomicBool,
}

impl GlobalMcpStartupRegistration {
    pub(crate) fn start(
        &self,
        context: GlobalMcpStartupContext,
        report: impl Fn(GlobalMcpStartupEvent) + Send + Sync + 'static,
    ) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let report = Arc::new(report);
        let worker_report = Arc::clone(&report);
        // No join handle is retained: config locks, filesystem IO and executable
        // discovery never gate readiness, listener startup or provider launches.
        if std::thread::Builder::new()
            .name("ticketry-global-mcp".into())
            .spawn(move || register_providers(context, &*worker_report))
            .is_err()
        {
            for provider in ["claude", "codex"] {
                report(GlobalMcpStartupEvent {
                    provider,
                    outcome: "failed",
                    reason: Some("worker_unavailable"),
                });
            }
        }
    }
}

fn register_providers(context: GlobalMcpStartupContext, report: &impl Fn(GlobalMcpStartupEvent)) {
    if !context.packaged_app
        || context.development_build
        || context.data_directory_overrides.into_iter().any(|set| set)
    {
        for provider in ["claude", "codex"] {
            report(GlobalMcpStartupEvent {
                provider,
                outcome: "skipped",
                reason: Some("development_instance"),
            });
        }
        return;
    }
    // Provider additions share this worker and the process-wide guard. Discovery
    // must stay here because even a bounded version probe can take seconds.
    let executable = context.claude_executable.or_else(|| {
        let discovered = discover_tool(SupportedTool::Claude);
        discovered
            .executable
            .then_some(discovered.path)
            .flatten()
            .map(PathBuf::from)
    });
    let outcome = register_claude_global_mcp(GlobalMcpRegistrationContext {
        hook_runner: &context.hook_runner,
        data_directory: &context.data_directory,
        config_file: context.claude_config_file.as_deref(),
        executable: executable.as_deref(),
    });
    report(provider_event("claude", outcome));
    let executable = context.codex_executable.or_else(|| {
        let discovered = discover_tool(SupportedTool::Codex);
        discovered
            .executable
            .then_some(discovered.path)
            .flatten()
            .map(PathBuf::from)
    });
    let outcome = register_codex_global_mcp(GlobalMcpRegistrationContext {
        hook_runner: &context.hook_runner,
        data_directory: &context.data_directory,
        config_file: context.codex_config_file.as_deref(),
        executable: executable.as_deref(),
    });
    report(provider_event("codex", outcome));
}

fn provider_event(
    provider: &'static str,
    outcome: GlobalMcpRegistrationOutcome,
) -> GlobalMcpStartupEvent {
    let (outcome, reason) = match outcome {
        GlobalMcpRegistrationOutcome::Registered => ("registered", None),
        GlobalMcpRegistrationOutcome::Updated => ("updated", None),
        GlobalMcpRegistrationOutcome::Unchanged => ("unchanged", None),
        GlobalMcpRegistrationOutcome::Skipped { reason } => (
            "skipped",
            Some(match reason.as_str() {
                "foreign_entry" => "foreign_entry",
                "provider_not_installed" => "provider_not_installed",
                _ => "provider_skipped",
            }),
        ),
        GlobalMcpRegistrationOutcome::Failed { diagnostic } => (
            "failed",
            Some(match diagnostic.as_str() {
                "locked" => "locked",
                "invalid_state" => "invalid_state",
                "state_changed" => "state_changed",
                "write_failed" => "write_failed",
                "invalid_paths" => "invalid_paths",
                "configuration_path_unavailable" => "configuration_path_unavailable",
                "state_read_failed" => "state_read_failed",
                _ => "registration_failed",
            }),
        ),
    };
    GlobalMcpStartupEvent {
        provider,
        outcome,
        reason,
    }
}

#[cfg(test)]
#[path = "global_mcp_registration_tests.rs"]
mod tests;
