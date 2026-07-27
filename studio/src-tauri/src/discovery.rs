//! Trusted executable discovery for the desktop shell.
//!
//! Discovery deliberately never asks a shell to resolve a command.  It walks
//! a small, inspectable set of directories and runs a validated candidate only
//! with its version flag and an empty environment.

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::ownership::established_data_directory;

const APPROVED_PATHS_FILE: &str = "approved-executables.json";

const SUPPORTED_TOOLS: [SupportedTool; 5] = [
    SupportedTool::Tmux,
    SupportedTool::Claude,
    SupportedTool::Agy,
    SupportedTool::Codex,
    SupportedTool::Gemini,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportedTool {
    Tmux,
    Claude,
    Agy,
    Codex,
    Gemini,
}

impl SupportedTool {
    pub fn executable_name(self) -> &'static str {
        match self {
            Self::Tmux => "tmux",
            Self::Claude => "claude",
            Self::Agy => "agy",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
        }
    }

    fn environment_name(self) -> &'static str {
        match self {
            Self::Tmux => "MUXED_APPROVED_TMUX_PATH",
            Self::Claude => "MUXED_APPROVED_CLAUDE_PATH",
            Self::Agy => "MUXED_APPROVED_AGY_PATH",
            Self::Codex => "MUXED_APPROVED_CODEX_PATH",
            Self::Gemini => "MUXED_APPROVED_GEMINI_PATH",
        }
    }

    fn version_argument(self) -> &'static str {
        match self {
            Self::Tmux => "-V",
            _ => "--version",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolHealth {
    Ready,
    Missing,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDiagnostic {
    pub tool: SupportedTool,
    pub health: ToolHealth,
    pub path: Option<String>,
    pub version: Option<String>,
    pub executable: bool,
    pub architecture: String,
    pub capabilities: Vec<String>,
    pub guidance: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessHint {
    pub working_directory: String,
    pub exists: bool,
    pub readable: bool,
    pub writable: bool,
    pub guidance: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub target: String,
    pub tools: Vec<ToolDiagnostic>,
    pub repository_access: AccessHint,
    pub os_permission_hint: Option<String>,
}

/// A fixed selection made through the desktop's named-tool approval command.
/// The path itself is never executable until it passes the same inspection as
/// an automatically discovered candidate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovedToolPath {
    tool: SupportedTool,
    path: PathBuf,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovedToolPaths {
    tools: Vec<ApprovedToolPath>,
}

impl ApprovedToolPaths {
    fn load(data_directory: &Path) -> Result<Self, String> {
        let path = data_directory.join(APPROVED_PATHS_FILE);
        match fs::read_to_string(path) {
            Ok(contents) => serde_json::from_str(&contents)
                .map_err(|_| "saved executable approvals are unreadable".to_owned()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("saved executable approvals could not be read".to_owned()),
        }
    }

    fn path_for(&self, tool: SupportedTool) -> Option<&Path> {
        self.tools
            .iter()
            .find(|choice| choice.tool == tool)
            .map(|choice| choice.path.as_path())
    }

    fn replace(&mut self, tool: SupportedTool, path: PathBuf) {
        self.tools.retain(|choice| choice.tool != tool);
        self.tools.push(ApprovedToolPath { tool, path });
        self.tools
            .sort_by_key(|choice| choice.tool.executable_name());
    }

    fn save(&self, data_directory: &Path) -> Result<(), String> {
        fs::create_dir_all(data_directory)
            .map_err(|_| "approved executable directory could not be created".to_owned())?;
        let destination = data_directory.join(APPROVED_PATHS_FILE);
        let temporary =
            data_directory.join(format!(".{APPROVED_PATHS_FILE}.tmp-{}", std::process::id()));
        let encoded = serde_json::to_vec_pretty(self)
            .map_err(|_| "approved executable selections could not be encoded".to_owned())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "approved executable selections could not be saved".to_owned())?;
        file.write_all(&encoded)
            .and_then(|_| file.sync_all())
            .map_err(|_| "approved executable selections could not be saved".to_owned())?;
        fs::rename(&temporary, destination)
            .map_err(|_| "approved executable selections could not be saved".to_owned())
    }
}

pub fn preflight_report() -> PreflightReport {
    let service = DiscoveryService::from_environment().unwrap_or_else(|_| DiscoveryService {
        roots: trusted_roots(env::var_os("HOME").as_deref().map(Path::new)),
        approved: ApprovedToolPaths::default(),
    });
    let tools = SUPPORTED_TOOLS
        .into_iter()
        .map(|tool| service.discover(tool))
        .collect();
    let repository_access = working_directory_hint();
    PreflightReport {
        target: format!("{}-{}", env::consts::OS, env::consts::ARCH),
        tools,
        repository_access,
        os_permission_hint: platform_permission_hint(),
    }
}

/// Validate and durably approve one absolute path for one named tool. This is
/// intentionally the only path-bearing desktop command; it cannot choose a
/// program name, arguments, shell, or environment.
pub fn approve_executable_path(
    tool: SupportedTool,
    candidate: PathBuf,
) -> Result<ToolDiagnostic, String> {
    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    approve_executable_path_in(&data_directory, tool, candidate)
}

fn approve_executable_path_in(
    data_directory: &Path,
    tool: SupportedTool,
    candidate: PathBuf,
) -> Result<ToolDiagnostic, String> {
    if !candidate.is_absolute() {
        return Err("approved executable path must be absolute".to_owned());
    }
    let candidate = fs::canonicalize(&candidate)
        .map_err(|_| "approved executable path could not be resolved".to_owned())?;
    let diagnostic = inspect_candidate(&candidate, tool, |path, flag| version_probe(path, flag))?;
    let mut approved = ApprovedToolPaths::load(data_directory)?;
    approved.replace(tool, candidate);
    approved.save(data_directory)?;
    Ok(diagnostic)
}

/// Environment entries for the packaged backend. The values are created only
/// from the discovery service's validated results, never from webview input.
pub fn resolved_tool_environment() -> Result<Vec<(String, String)>, String> {
    let service = DiscoveryService::from_environment()?;
    Ok(resolved_tool_environment_from_service(&service))
}

fn resolved_tool_environment_from_service(service: &DiscoveryService) -> Vec<(String, String)> {
    let mut resolved = Vec::new();
    let mut directories = Vec::new();
    for tool in SUPPORTED_TOOLS {
        let diagnostic = service.discover(tool);
        if diagnostic.health != ToolHealth::Ready {
            continue;
        }
        let path = diagnostic.path.expect("ready diagnostics have a path");
        if let Some(parent) = Path::new(&path).parent() {
            directories.push(parent.to_path_buf());
        }
        resolved.push((tool.environment_name().to_owned(), path));
    }
    directories.sort();
    directories.dedup();
    // libtmux internally uses `which("tmux")`; this deliberately bounded PATH
    // lets that dependency find only the same Rust-approved binary. Agent
    // commands are replaced with their absolute approved paths below.
    let mut probe_path = directories;
    probe_path.extend([PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
    let path = env::join_paths(probe_path).unwrap_or_default();
    resolved.push(("PATH".to_owned(), path.to_string_lossy().into_owned()));
    resolved
}

struct DiscoveryService {
    roots: Vec<PathBuf>,
    approved: ApprovedToolPaths,
}

impl DiscoveryService {
    fn from_environment() -> Result<Self, String> {
        // Deliberately use HOME only to locate well-known, inspectable layouts;
        // PATH, shell configuration, and version-manager commands are never read.
        let home = env::var_os("HOME").map(PathBuf::from);
        let data_directory = established_data_directory().map_err(|error| error.to_string())?;
        Ok(Self {
            roots: trusted_roots(home.as_deref()),
            approved: ApprovedToolPaths::load(&data_directory)?,
        })
    }

    fn discover(&self, tool: SupportedTool) -> ToolDiagnostic {
        if let Some(candidate) = self.approved.path_for(tool) {
            return match inspect_candidate(candidate, tool, |path, flag| version_probe(path, flag))
            {
                Ok(diagnostic) => diagnostic,
                Err(reason) => candidate_diagnostic(tool, candidate, reason),
            };
        }
        let mut invalid = None;
        for directory in &self.roots {
            let candidate = directory.join(tool.executable_name());
            if !candidate.is_file() {
                continue;
            }
            match inspect_candidate(&candidate, tool, |path, flag| version_probe(path, flag)) {
                Ok(diagnostic) => return diagnostic,
                Err(reason) => {
                    invalid.get_or_insert_with(|| candidate_diagnostic(tool, &candidate, reason))
                }
            };
        }
        invalid.unwrap_or_else(|| missing_diagnostic(tool))
    }
}

fn trusted_roots(home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = match env::consts::OS {
        "macos" => vec!["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"],
        "linux" => vec!["/usr/local/bin", "/usr/bin", "/bin"],
        "windows" => Vec::new(),
        _ => vec!["/usr/local/bin", "/usr/bin"],
    }
    .into_iter()
    .map(PathBuf::from)
    .collect();

    if let Some(home) = home {
        roots.push(home.join(".local/bin"));
        roots.push(home.join(".volta/bin"));
        // These are layouts only. We inspect directories directly and never run
        // nvm, fnm, mise, asdf, or their shell integration.
        roots.extend(version_manager_bins(home, ".nvm/versions/node", "bin"));
        roots.extend(version_manager_bins(
            home,
            ".fnm/node-versions",
            "installation/bin",
        ));
        roots.extend(version_manager_bins(
            home,
            ".local/share/mise/installs/node",
            "bin",
        ));
        roots.extend(version_manager_bins(home, ".asdf/installs/nodejs", "bin"));
    }
    roots.sort();
    roots.dedup();
    roots
}

fn version_manager_bins(home: &Path, relative: &str, suffix: &str) -> Vec<PathBuf> {
    let parent = home.join(relative);
    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path().join(suffix))
        .filter(|path| path.is_dir())
        .collect()
}

fn inspect_candidate<F>(
    candidate: &Path,
    tool: SupportedTool,
    probe: F,
) -> Result<ToolDiagnostic, String>
where
    F: FnOnce(&Path, &str) -> Result<String, String>,
{
    let file_name = candidate.file_name().and_then(|name| name.to_str());
    if file_name != Some(tool.executable_name()) {
        return Err("candidate identity does not match the supported tool".to_owned());
    }
    if !is_executable(candidate)? {
        return Err("candidate is not executable".to_owned());
    }
    let architecture = architecture_status(candidate)?;
    if architecture == "incompatible" {
        return Err("candidate architecture is incompatible with this desktop target".to_owned());
    }
    let version = normalized_version(probe(candidate, tool.version_argument())?)
        .ok_or_else(|| "candidate did not return a recognizable version".to_owned())?;
    Ok(ToolDiagnostic {
        tool,
        health: ToolHealth::Ready,
        path: Some(display_path(candidate)),
        version: Some(version),
        executable: true,
        architecture,
        capabilities: vec!["version_probe".to_owned()],
        guidance: None,
    })
}

fn version_probe(candidate: &Path, flag: &str) -> Result<String, String> {
    let output = Command::new(candidate)
        .arg(flag)
        .env_clear()
        // Node-installed CLIs commonly use `#!/usr/bin/env node`.  Give that
        // interpreter a deterministic path rooted at the candidate directory,
        // rather than inheriting the Finder or terminal PATH.
        .env("PATH", safe_probe_path(candidate))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|_| "version probe could not start".to_owned())?;
    if !output.status.success() {
        return Err("version probe returned a failure status".to_owned());
    }
    let value = if output.stdout.is_empty() {
        output.stderr
    } else {
        output.stdout
    };
    String::from_utf8(value).map_err(|_| "version probe returned non-text output".to_owned())
}

fn safe_probe_path(candidate: &Path) -> String {
    let mut paths = candidate
        .parent()
        .map(Path::to_path_buf)
        .into_iter()
        .collect::<Vec<_>>();
    paths.extend([PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
    env::join_paths(paths)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn normalized_version(output: String) -> Option<String> {
    let first = output.lines().find(|line| !line.trim().is_empty())?.trim();
    let start = first.find(|character: char| character.is_ascii_digit())?;
    let version: String = first[start..]
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn is_executable(candidate: &Path) -> Result<bool, String> {
    let metadata = fs::metadata(candidate).map_err(|_| "could not inspect candidate".to_owned())?;
    if !metadata.is_file() {
        return Ok(false);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Ok(metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        Ok(true)
    }
}

fn architecture_status(candidate: &Path) -> Result<String, String> {
    let bytes = fs::read(candidate).map_err(|_| "could not read candidate header".to_owned())?;
    // Scripts are architecture-neutral: their interpreter is selected by the OS.
    if bytes.starts_with(b"#!") || bytes.len() < 20 {
        return Ok("script".to_owned());
    }
    if bytes.starts_with(b"\x7fELF") {
        let machine = u16::from_le_bytes([bytes[18], bytes[19]]);
        return Ok(match (env::consts::ARCH, machine) {
            ("x86_64", 62) | ("aarch64", 183) => "native".to_owned(),
            _ => "incompatible".to_owned(),
        });
    }
    if bytes.len() >= 8 {
        let magic = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        // Thin Mach-O header: cputype is native endian after the magic.
        if matches!(magic, 0xfeedfacf | 0xcffaedfe) {
            // `magic` was read big-endian solely to identify both byte orders.
            // The byte order of the cputype field is the header's native order;
            // accept the expected value in either representation so a native
            // arm64/x86_64 thin binary is not rejected as byte-swapped.
            let cpu_little = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
            let cpu_big = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
            let expected_cpu = match env::consts::ARCH {
                "x86_64" => 0x0100_0007,
                "aarch64" => 0x0100_000c,
                _ => return Ok("incompatible".to_owned()),
            };
            return Ok(
                match (cpu_little == expected_cpu, cpu_big == expected_cpu) {
                    (true, _) | (_, true) => "native".to_owned(),
                    _ => "incompatible".to_owned(),
                },
            );
        }
    }
    // Text launchers and portable wrappers are permitted; the version probe is
    // the final compatibility check in that case.
    Ok("not_applicable".to_owned())
}

fn missing_diagnostic(tool: SupportedTool) -> ToolDiagnostic {
    ToolDiagnostic {
        tool,
        health: ToolHealth::Missing,
        path: None,
        version: None,
        executable: false,
        architecture: "unknown".to_owned(),
        capabilities: Vec::new(),
        guidance: Some(missing_guidance(tool)),
    }
}

fn missing_guidance(tool: SupportedTool) -> String {
    if tool == SupportedTool::Tmux {
        return match env::consts::OS {
            "macos" => "tmux is a macOS prerequisite; Muxed Studio does not bundle it. Install it with Homebrew (`brew install tmux`) or approve a compatible absolute path.".to_owned(),
            "linux" => "tmux is a Linux prerequisite; install it through your distribution package manager or approve a compatible absolute path.".to_owned(),
            "windows" => "Windows is not a supported desktop target because Muxed Studio requires tmux.".to_owned(),
            _ => "tmux is required by Muxed Studio and must be installed through the supported platform workflow.".to_owned(),
        };
    }
    format!(
        "{} was not found in trusted desktop locations; install it with your platform's supported package workflow or approve its absolute path.",
        tool.executable_name()
    )
}

fn candidate_diagnostic(tool: SupportedTool, path: &Path, reason: String) -> ToolDiagnostic {
    ToolDiagnostic {
        tool,
        health: ToolHealth::Invalid,
        path: Some(display_path(path)),
        version: None,
        executable: false,
        architecture: "unknown".to_owned(),
        capabilities: Vec::new(),
        guidance: Some(reason),
    }
}

fn display_path(path: &Path) -> String {
    // A filesystem path contains no credentials. Do not include command output,
    // environment values, or arbitrary errors in the serializable report.
    path.to_string_lossy().into_owned()
}

fn working_directory_hint() -> AccessHint {
    let path = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let exists = path.exists();
    let readable = fs::read_dir(&path).is_ok();
    let writable = if exists {
        let probe = path.join(format!(".muxed-preflight-{}", std::process::id()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(_) => {
                let _ = fs::remove_file(probe);
                true
            }
            Err(_) => false,
        }
    } else {
        false
    };
    AccessHint {
        working_directory: display_path(&path),
        exists,
        readable,
        writable,
        guidance: (!exists || !readable || !writable).then(|| {
            "Choose a local repository directory that the desktop app can read and write."
                .to_owned()
        }),
    }
}

fn platform_permission_hint() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        Some("If the repository is in Desktop, Documents, or another protected location, grant Muxed Studio Files and Folders access in macOS Settings.".to_owned())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_dir(name: &str) -> PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!("muxed-discovery-{name}-{id}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn executable(path: &Path, contents: &[u8]) {
        let mut file = File::create(path).unwrap();
        file.write_all(contents).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn discovers_a_package_manager_fixture_without_path_or_shell() {
        let root = fixture_dir("package-manager");
        let candidate = root.join("codex");
        executable(&candidate, b"#!/bin/sh\nprintf 'codex 0.42.0\\n'\n");
        let service = DiscoveryService {
            roots: vec![root.clone()],
            approved: ApprovedToolPaths::default(),
        };
        let report = service.discover(SupportedTool::Codex);
        let diagnostic = inspect_candidate(&candidate, SupportedTool::Codex, |_, _| {
            Ok("codex 0.42.0".to_owned())
        })
        .unwrap();
        assert_eq!(diagnostic.health, ToolHealth::Ready);
        assert_eq!(diagnostic.version.as_deref(), Some("0.42.0"));
        assert_eq!(report.health, ToolHealth::Ready);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn version_manager_layout_and_paths_with_spaces_are_traversed() {
        let home = fixture_dir("home with spaces");
        let bin = home.join(".nvm/versions/node/v22.1.0/bin");
        fs::create_dir_all(&bin).unwrap();
        let candidate = bin.join("gemini");
        executable(&candidate, b"#!/bin/sh\n");
        assert!(version_manager_bins(&home, ".nvm/versions/node", "bin").contains(&bin));
        let diagnostic = inspect_candidate(&candidate, SupportedTool::Gemini, |_, _| {
            Ok("gemini 1.2.3".to_owned())
        })
        .unwrap();
        assert!(diagnostic.path.unwrap().contains("home with spaces"));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_stale_wrong_named_and_non_executable_candidates() {
        let root = fixture_dir("invalid");
        let stale = root.join("claude");
        let wrong_name = root.join("not-claude");
        executable(&stale, b"#!/bin/sh\n");
        executable(&wrong_name, b"#!/bin/sh\n");
        #[cfg(unix)]
        fs::set_permissions(&stale, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(inspect_candidate(&stale, SupportedTool::Claude, |_, _| Ok(
            "claude 1.0.0".to_owned()
        ))
        .is_err());
        assert!(
            inspect_candidate(&wrong_name, SupportedTool::Claude, |_, _| Ok(
                "claude 1.0.0".to_owned()
            ))
            .is_err()
        );
        assert!(
            inspect_candidate(&root.join("missing"), SupportedTool::Claude, |_, _| Ok(
                "claude 1.0.0".to_owned()
            ))
            .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_wrong_architecture_and_incompatible_versions() {
        let root = fixture_dir("architecture");
        let candidate = root.join("tmux");
        let mut elf = vec![0_u8; 20];
        elf[..4].copy_from_slice(b"\x7fELF");
        elf[18..20].copy_from_slice(&999_u16.to_le_bytes());
        executable(&candidate, &elf);
        assert!(
            inspect_candidate(&candidate, SupportedTool::Tmux, |_, _| Ok(
                "tmux 3.4".to_owned()
            ))
            .is_err()
        );
        let script = root.join("codex");
        executable(&script, b"#!/bin/sh\n");
        assert!(inspect_candidate(&script, SupportedTool::Codex, |_, _| Ok(
            "codex development".to_owned()
        ))
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recognizes_native_thin_macho_headers_in_their_native_byte_order() {
        let root = fixture_dir("native macho");
        let candidate = root.join("tmux");
        let expected_cpu: u32 = match env::consts::ARCH {
            "x86_64" => 0x0100_0007,
            "aarch64" => 0x0100_000c,
            _ => return,
        };
        let mut header = vec![0_u8; 20];
        header[..4].copy_from_slice(&0xfeed_facf_u32.to_le_bytes());
        header[4..8].copy_from_slice(&expected_cpu.to_le_bytes());
        executable(&candidate, &header);

        assert_eq!(architecture_status(&candidate), Ok("native".to_owned()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn approved_absolute_path_is_persisted_and_preferred_on_relaunch() {
        let root = fixture_dir("approved path with spaces");
        let data_dir = root.join("application data");
        let candidate = root.join("custom/bin/codex");
        fs::create_dir_all(candidate.parent().unwrap()).unwrap();
        executable(&candidate, b"#!/bin/sh\nprintf 'codex 1.2.3\\n'\n");

        let approved = approve_executable_path_in(&data_dir, SupportedTool::Codex, candidate)
            .expect("approve valid explicit path");
        assert_eq!(approved.health, ToolHealth::Ready);

        let reloaded = ApprovedToolPaths::load(&data_dir).expect("reload approvals");
        let service = DiscoveryService {
            roots: Vec::new(),
            approved: reloaded,
        };
        let report = service.discover(SupportedTool::Codex);
        assert_eq!(report.health, ToolHealth::Ready);
        assert_eq!(report.version.as_deref(), Some("1.2.3"));
        assert!(report.path.unwrap().contains("approved path with spaces"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_explicit_path_is_not_persisted_or_exported_to_the_backend() {
        let root = fixture_dir("invalid approval");
        let data_dir = root.join("application data");
        let wrong_tool = root.join("claude");
        executable(&wrong_tool, b"#!/bin/sh\nprintf 'claude 1.2.3\\n'\n");

        let error = approve_executable_path_in(&data_dir, SupportedTool::Codex, wrong_tool)
            .expect_err("wrong named tool is rejected");
        assert!(error.contains("identity"));
        assert!(!data_dir.join(APPROVED_PATHS_FILE).exists());

        let environment = resolved_tool_environment_from_service(&DiscoveryService {
            roots: Vec::new(),
            approved: ApprovedToolPaths::default(),
        });
        assert!(!environment
            .iter()
            .any(|(name, _)| name == "MUXED_APPROVED_CODEX_PATH"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn report_serialization_never_includes_probe_output_or_environment_secrets() {
        let diagnostic =
            inspect_candidate(Path::new("/tmp/codex"), SupportedTool::Codex, |_, _| {
                Ok("token=secret 1.2.3".to_owned())
            });
        assert!(diagnostic.is_err());
        let report = PreflightReport {
            target: "test".to_owned(),
            tools: vec![missing_diagnostic(SupportedTool::Codex)],
            repository_access: working_directory_hint(),
            os_permission_hint: None,
        };
        assert!(!serde_json::to_string(&report).unwrap().contains("secret"));
    }
}
