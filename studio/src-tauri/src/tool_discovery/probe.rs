//! Inspecting one candidate executable.
//!
//! A candidate is run only with its version flag and an empty environment, and
//! only after it is confirmed executable and architecture-compatible.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::diagnostics::{display_path, ToolDiagnostic, ToolHealth};
use super::supported_tools::SupportedTool;

pub(super) fn inspect_candidate<F>(
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

pub(super) fn version_probe(candidate: &Path, flag: &str) -> Result<String, String> {
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

pub(super) fn architecture_status(candidate: &Path) -> Result<String, String> {
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
