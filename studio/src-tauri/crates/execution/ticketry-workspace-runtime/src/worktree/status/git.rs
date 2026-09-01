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

use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::error::WorktreeStatusError;

/// Git output beyond this is a diagnostic, not data. Porcelain status, commit
/// counts, and unmerged file lists are all far smaller.
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

const GIT_TIMEOUT: Duration = Duration::from_secs(30);
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// The executable name resolved through the inherited PATH, never a
/// caller-supplied program.
const GIT_PROGRAM: &str = "git";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitOutcome {
    pub succeeded: bool,
    pub stdout: String,
    /// Whether stdout exceeded the retained byte limit. NUL-delimited readers
    /// use this to discard a final partial record and report truncation.
    pub stdout_truncated: bool,
    /// Whether the retained stdout bytes were valid UTF-8 before conversion.
    /// For truncated NUL-delimited output, validation covers only complete
    /// retained records because the byte cap may split a valid final codepoint.
    /// Existing text consumers keep their string view; path consumers can
    /// reject lossy bytes from every complete filename.
    pub stdout_valid_utf8: bool,
    /// Git's diagnostic channel, bounded like `stdout`. It is the reason a
    /// failed effect can be reported without reconstructing a command line.
    pub stderr: String,
}

impl GitOutcome {
    pub fn trimmed_stdout(&self) -> &str {
        self.stdout.trim()
    }

    pub fn trimmed_stderr(&self) -> &str {
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
        tokio::task::spawn_blocking(move || run_command(command, GIT_TIMEOUT))
            .await
            .map_err(|_| WorktreeStatusError::git_unavailable("Git inspection did not complete."))?
    }
}

struct BoundedOutput {
    retained: Vec<u8>,
    truncated: bool,
}

fn run_command(mut command: Command, timeout: Duration) -> Result<GitOutcome, WorktreeStatusError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(WorktreeStatusError::git_unavailable(
                "Git is not available on this system.",
            ));
        }
        Err(_) => {
            return Err(WorktreeStatusError::git_unavailable(
                "Git could not be run for this repository.",
            ));
        }
    };
    let Some(stdout) = child.stdout.take() else {
        terminate(&mut child);
        return Err(output_failure());
    };
    let Some(stderr) = child.stderr.take() else {
        terminate(&mut child);
        return Err(output_failure());
    };
    let stdout_reader = match spawn_reader("ticketry-git-stdout", stdout) {
        Ok(reader) => reader,
        Err(_) => {
            terminate(&mut child);
            return Err(output_failure());
        }
    };
    let stderr_reader = match spawn_reader("ticketry-git-stderr", stderr) {
        Ok(reader) => reader,
        Err(_) => {
            terminate(&mut child);
            return Err(output_failure());
        }
    };

    let status = wait_for_completion(
        &mut child,
        &stdout_reader,
        &stderr_reader,
        Instant::now() + timeout,
    )?;
    let stdout = join_reader(stdout_reader)?;
    let stderr = join_reader(stderr_reader)?;
    let stdout_valid_utf8 = retained_stdout_is_utf8(&stdout.retained, stdout.truncated);

    Ok(GitOutcome {
        succeeded: status.success(),
        stdout: String::from_utf8_lossy(&stdout.retained).into_owned(),
        stdout_truncated: stdout.truncated,
        stdout_valid_utf8,
        stderr: String::from_utf8_lossy(&stderr.retained).into_owned(),
    })
}

fn spawn_reader<R>(
    name: &str,
    reader: R,
) -> io::Result<thread::JoinHandle<io::Result<BoundedOutput>>>
where
    R: Read + Send + 'static,
{
    thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || drain_bounded(reader))
}

fn drain_bounded(mut reader: impl Read) -> io::Result<BoundedOutput> {
    let mut retained = Vec::with_capacity(MAX_OUTPUT_BYTES);
    let mut truncated = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let available = MAX_OUTPUT_BYTES.saturating_sub(retained.len());
        let keep = available.min(read);
        retained.extend_from_slice(&buffer[..keep]);
        truncated |= keep < read;
    }
    Ok(BoundedOutput {
        retained,
        truncated,
    })
}

fn retained_stdout_is_utf8(retained: &[u8], truncated: bool) -> bool {
    let complete = if truncated {
        retained
            .iter()
            .rposition(|byte| *byte == b'\0')
            .map_or(&[][..], |end| &retained[..=end])
    } else {
        retained
    };
    std::str::from_utf8(complete).is_ok()
}

fn wait_for_completion(
    child: &mut std::process::Child,
    stdout: &thread::JoinHandle<io::Result<BoundedOutput>>,
    stderr: &thread::JoinHandle<io::Result<BoundedOutput>>,
    deadline: Instant,
) -> Result<ExitStatus, WorktreeStatusError> {
    let mut status = None;
    loop {
        if status.is_none() {
            status = match child.try_wait() {
                Ok(status) => status,
                Err(_) => {
                    terminate(child);
                    return Err(WorktreeStatusError::git_unavailable(
                        "Git inspection did not complete.",
                    ));
                }
            };
        }
        if status.is_some() && stdout.is_finished() && stderr.is_finished() {
            return Ok(status.expect("status was checked"));
        }
        let now = Instant::now();
        if now >= deadline {
            terminate(child);
            return Err(WorktreeStatusError::git_unavailable(
                "Git inspection timed out.",
            ));
        }
        thread::sleep(WAIT_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    }
}

fn join_reader(
    reader: thread::JoinHandle<io::Result<BoundedOutput>>,
) -> Result<BoundedOutput, WorktreeStatusError> {
    reader
        .join()
        .map_err(|_| output_failure())?
        .map_err(|_| output_failure())
}

fn terminate(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn output_failure() -> WorktreeStatusError {
    WorktreeStatusError::git_unavailable("Git output could not be read.")
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

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
        let output = drain_bounded(std::io::Cursor::new(raw)).expect("drain bounded bytes");
        assert_eq!(output.retained.len(), MAX_OUTPUT_BYTES);
        assert!(output.truncated);
    }

    #[test]
    fn truncated_utf8_validation_ignores_only_the_partial_nul_record() {
        let split_codepoint = b"?? complete.txt\0?? partial-\xe2\x82";
        assert!(retained_stdout_is_utf8(split_codepoint, true));

        let invalid_complete_record = b"?? invalid-\xff.txt\0?? partial-\xe2\x82";
        assert!(!retained_stdout_is_utf8(invalid_complete_record, true));
        assert!(!retained_stdout_is_utf8(split_codepoint, false));
    }

    #[cfg(unix)]
    #[test]
    fn both_command_pipes_are_drained_after_the_retained_limit() {
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "head -c 131072 /dev/zero; head -c 131072 /dev/zero >&2",
        ]);

        let outcome = run_command(command, Duration::from_secs(5)).expect("run bounded command");

        assert!(outcome.succeeded);
        assert_eq!(outcome.stdout.len(), MAX_OUTPUT_BYTES);
        assert!(outcome.stdout_truncated);
        assert_eq!(outcome.stderr.len(), MAX_OUTPUT_BYTES);
    }

    #[cfg(unix)]
    #[test]
    fn a_command_past_its_deadline_is_killed_and_typed() {
        let mut command = Command::new("sh");
        command.args(["-c", "while :; do :; done"]);
        let started = Instant::now();

        let error =
            run_command(command, Duration::from_millis(50)).expect_err("the command must time out");

        assert_eq!(
            error.code(),
            super::super::WorktreeStatusErrorCode::GitUnavailable
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
