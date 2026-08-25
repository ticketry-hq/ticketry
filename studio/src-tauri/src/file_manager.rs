//! Open one existing directory in the operating system's file manager.

use std::path::Path;
use std::process::Command;

use crate::process_spawn;

pub(crate) fn reveal(path: &str) -> Result<(), String> {
    let directory = validated_directory(path)?;
    let mut command = opener(directory);
    let status = process_spawn::status(&mut command)
        .map_err(|_| "the system file manager could not be started".to_owned())?;
    if status.success() {
        Ok(())
    } else {
        Err("the system file manager refused to open the worktree".to_owned())
    }
}

fn validated_directory(path: &str) -> Result<&Path, String> {
    let directory = Path::new(path);
    if !directory.is_absolute() {
        return Err("the worktree path must be absolute".to_owned());
    }
    if !directory.is_dir() {
        return Err("the worktree path is not an existing directory".to_owned());
    }
    Ok(directory)
}

#[cfg(target_os = "macos")]
fn opener(path: &Path) -> Command {
    let mut command = Command::new("/usr/bin/open");
    command.arg("--").arg(path);
    command
}

#[cfg(target_os = "windows")]
fn opener(path: &Path) -> Command {
    let mut command = Command::new("explorer.exe");
    command.arg(path);
    command
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn opener(path: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_an_existing_absolute_directory() {
        let current = std::env::current_dir().expect("current directory");
        let current = current.to_str().expect("Unicode current directory");
        assert_eq!(validated_directory(current), Ok(Path::new(current)));
    }

    #[test]
    fn rejects_relative_and_missing_paths() {
        assert!(validated_directory("relative/worktree").is_err());
        assert!(validated_directory("/ticketry/path/that/does/not/exist").is_err());
    }
}
