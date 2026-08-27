use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{shell_quote, ApprovedArgv, TmuxAdapterError};

// tmux rejects control messages near its internal command-size ceiling. Keep
// direct hosted commands comfortably below it and route larger argv through a
// private, run-scoped wrapper.
const DIRECT_COMMAND_MAX_BYTES: usize = 8 * 1024;
const ARTIFACT_PARENT: &str = "ticketry-agent-runs";

pub(super) struct HostedCommand {
    tmux_command: OsString,
    wrapper: Option<LaunchWrapper>,
}

impl HostedCommand {
    pub(super) fn prepare(
        agent_run_id: &str,
        command: &ApprovedArgv,
    ) -> Result<Self, TmuxAdapterError> {
        let command_line = shell_join(command)?;
        if command_line.len() <= DIRECT_COMMAND_MAX_BYTES {
            return Ok(Self {
                tmux_command: command_line.into(),
                wrapper: None,
            });
        }

        let wrapper = LaunchWrapper::create(agent_run_id, &command_line)?;
        Ok(Self {
            tmux_command: shell_quote(path_text(&wrapper.path)?).into(),
            wrapper: Some(wrapper),
        })
    }

    pub(super) fn tmux_command(&self) -> &OsString {
        &self.tmux_command
    }

    /// tmux accepted the wrapper path. The wrapper now owns deletion and
    /// removes itself immediately before replacing the shell with the provider.
    pub(super) fn release_to_process(mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            wrapper.cleanup_on_drop = false;
        }
    }
}

struct LaunchWrapper {
    path: PathBuf,
    invocation_root: PathBuf,
    run_root: PathBuf,
    parent: PathBuf,
    cleanup_on_drop: bool,
}

impl LaunchWrapper {
    fn create(agent_run_id: &str, command_line: &str) -> Result<Self, TmuxAdapterError> {
        let parent = std::env::temp_dir().join(ARTIFACT_PARENT);
        ensure_private_directory(&parent)?;
        let run_root = parent.join(agent_run_id);
        ensure_private_directory(&run_root)?;
        let invocation_root =
            run_root.join(format!("invocation-{}", uuid::Uuid::new_v4().simple()));
        ensure_private_directory(&invocation_root)?;
        let path = invocation_root.join("launch.sh");

        let script = format!(
            "#!/bin/sh\n/bin/rm -f -- {script}\n/bin/rmdir -- {invocation} {run_root} {parent} 2>/dev/null || :\nexec {command_line}\n",
            script = shell_quote(path_text(&path)?),
            invocation = shell_quote(path_text(&invocation_root)?),
            run_root = shell_quote(path_text(&run_root)?),
            parent = shell_quote(path_text(&parent)?),
        );
        if let Err(error) = write_executable(&path, script.as_bytes()) {
            cleanup_paths(&path, &invocation_root, &run_root, &parent);
            return Err(error);
        }

        Ok(Self {
            path,
            invocation_root,
            run_root,
            parent,
            cleanup_on_drop: true,
        })
    }
}

impl Drop for LaunchWrapper {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            cleanup_paths(
                &self.path,
                &self.invocation_root,
                &self.run_root,
                &self.parent,
            );
        }
    }
}

fn shell_join(command: &ApprovedArgv) -> Result<String, TmuxAdapterError> {
    std::iter::once(command.executable.as_os_str())
        .chain(command.arguments.iter().map(OsString::as_os_str))
        .map(|value| value.to_str().ok_or(TmuxAdapterError::InvalidOperation))
        .map(|value| value.map(shell_quote))
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.join(" "))
}

fn path_text(path: &Path) -> Result<&str, TmuxAdapterError> {
    path.to_str().ok_or(TmuxAdapterError::InvalidOperation)
}

fn ensure_private_directory(path: &Path) -> Result<(), TmuxAdapterError> {
    match fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(path)
                .map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(TmuxAdapterError::InvalidOperation);
            }
        }
        Err(error) => return Err(TmuxAdapterError::Unavailable(error.to_string())),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))?;
    }
    Ok(())
}

fn write_executable(path: &Path, contents: &[u8]) -> Result<(), TmuxAdapterError> {
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o700);
    }
    let mut file = options
        .open(path)
        .map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))?;
    file.write_all(contents)
        .map_err(|error| TmuxAdapterError::Unavailable(error.to_string()))
}

fn cleanup_paths(path: &Path, invocation_root: &Path, run_root: &Path, parent: &Path) {
    let _ = fs::remove_file(path);
    let _ = fs::remove_dir(invocation_root);
    let _ = fs::remove_dir(run_root);
    let _ = fs::remove_dir(parent);
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[test]
    fn oversized_command_uses_a_private_self_removing_wrapper() {
        let command = ApprovedArgv {
            executable: PathBuf::from("/bin/echo"),
            arguments: vec![OsString::from("large task context ".repeat(1_500))],
            working_directory: PathBuf::from("/tmp"),
            environment: BTreeMap::new(),
        };

        let hosted = HostedCommand::prepare("wrapper-unit-test", &command).unwrap();
        let wrapper = hosted.wrapper.as_ref().expect("oversized wrapper");
        let metadata = fs::metadata(&wrapper.path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(metadata.permissions().mode() & 0o777, 0o700);
        }
        let script = fs::read_to_string(&wrapper.path).unwrap();
        assert!(script.contains("large task context"));
        assert!(script.contains("/bin/rm -f --"));
        assert!(hosted.tmux_command().len() < DIRECT_COMMAND_MAX_BYTES);

        drop(hosted);
        assert!(!wrapper_artifact_root("wrapper-unit-test").exists());
    }

    fn wrapper_artifact_root(agent_run_id: &str) -> PathBuf {
        std::env::temp_dir()
            .join(ARTIFACT_PARENT)
            .join(agent_run_id)
    }
}
