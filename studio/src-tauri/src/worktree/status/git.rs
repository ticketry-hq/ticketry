//! The one approved way this capability talks to Git.
//!
//! Every invocation is an argument vector with a fixed executable and an
//! explicit working directory. No shell is involved, no caller text is ever
//! interpolated into a command line, and no command inherits the process
//! working directory — a status read must never silently describe whatever
//! checkout Ticketry happens to have been started from.
//!
//! Output is bounded before it can become an error message or durable
//! evidence, because Git can be made to print an unbounded amount of text.

use std::path::Path;
use std::process::Command;

use super::error::WorktreeStatusError;

/// Git output beyond this is a diagnostic, not data. Porcelain status, commit
/// counts, and unmerged file lists are all far smaller.
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

/// The executable name resolved through the inherited PATH, never a
/// caller-supplied program.
const GIT_PROGRAM: &str = "git";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitOutcome {
    pub succeeded: bool,
    pub stdout: String,
    /// Git's diagnostic channel, bounded like `stdout`. It is the reason a
    /// failed effect can be reported without reconstructing a command line.
    pub stderr: String,
}

impl GitOutcome {
    pub(crate) fn trimmed_stdout(&self) -> &str {
        self.stdout.trim()
    }

    pub(crate) fn trimmed_stderr(&self) -> &str {
        self.stderr.trim()
    }
}

/// The Git port. It runs the fixed argument vectors the worktree capabilities
/// need and reports failure as data wherever Git's non-zero exit is an
/// ordinary answer.
#[derive(Clone, Copy, Debug, Default)]
pub struct GitPort;

impl GitPort {
    pub fn new() -> Self {
        Self
    }

    /// Run `git -C <working_directory> <arguments>`.
    ///
    /// A non-zero exit is returned as `succeeded: false` so callers can treat
    /// "this is not a repository" or "that ref does not exist" as data. Only a
    /// missing or unusable Git executable is an error, because then nothing
    /// about the external world has been observed at all.
    pub async fn run(
        &self,
        arguments: &[&str],
        working_directory: &Path,
    ) -> Result<GitOutcome, WorktreeStatusError> {
        let mut command = Command::new(GIT_PROGRAM);
        command.arg("-C").arg(working_directory);
        command.args(arguments);
        // Git is blocking and the runtime is shared, so it runs off the async
        // worker rather than stalling every other in-flight request.
        let output = tokio::task::spawn_blocking(move || command.output())
            .await
            .map_err(|_| {
                WorktreeStatusError::git_unavailable("Git inspection did not complete.")
            })?;
        match output {
            Ok(output) => Ok(GitOutcome {
                succeeded: output.status.success(),
                stdout: bounded(&output.stdout),
                stderr: bounded(&output.stderr),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(
                WorktreeStatusError::git_unavailable("Git is not available on this system."),
            ),
            Err(_) => Err(WorktreeStatusError::git_unavailable(
                "Git could not be run for this repository.",
            )),
        }
    }
}

fn bounded(raw: &[u8]) -> String {
    let end = raw.len().min(MAX_OUTPUT_BYTES);
    String::from_utf8_lossy(&raw[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_non_repository_directory_is_data_rather_than_an_error() {
        let directory = tempfile::tempdir().expect("create a non-repository directory");

        let outcome = GitPort::new()
            .run(&["rev-parse", "--show-toplevel"], directory.path())
            .await
            .expect("Git itself is available");

        assert!(!outcome.succeeded);
        assert!(outcome.trimmed_stdout().is_empty());
    }

    #[test]
    fn output_is_bounded_before_it_can_become_a_message() {
        let raw = vec![b'x'; MAX_OUTPUT_BYTES + 4096];
        assert_eq!(bounded(&raw).len(), MAX_OUTPUT_BYTES);
    }
}
