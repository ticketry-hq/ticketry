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

/// Per-call limits for one Git invocation. Callers that parse unbounded-repo
/// data (diff previews, PR generators) tighten or widen these without
/// touching every other read.
#[derive(Clone, Copy, Debug)]
pub struct RunOptions {
    /// Retained stdout and stderr beyond this are marked truncated.
    pub max_output_bytes: usize,
    /// Wall-clock budget; a Git process past it is killed.
    pub timeout: Duration,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            max_output_bytes: MAX_OUTPUT_BYTES,
            timeout: GIT_TIMEOUT,
        }
    }
}

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
        self.run_with(arguments, working_directory, RunOptions::default())
            .await
    }

    /// Run the same contract with per-call output and wall-clock limits.
    pub async fn run_with(
        &self,
        arguments: &[&str],
        working_directory: &Path,
        options: RunOptions,
    ) -> Result<GitOutcome, WorktreeStatusError> {
        let mut command = Command::new(GIT_PROGRAM);
        command.arg("-C").arg(working_directory);
        // Locale-stable parsing and unquoted paths are contract requirements
        // for every read below, so the port applies them itself rather than
        // trusting callers to remember.
        command.env("LC_ALL", "C");
        command.arg("-c").arg("core.quotepath=false");
        command.args(arguments);
        // Git is blocking and the runtime is shared, so it runs off the async
        // worker rather than stalling every other in-flight request.
        tokio::task::spawn_blocking(move || run_command_with(command, options))
            .await
            .map_err(|_| WorktreeStatusError::git_unavailable("Git inspection did not complete."))?
    }
}

struct BoundedOutput {
    retained: Vec<u8>,
    truncated: bool,
    /// The pipe died mid-read. Retained bytes survive; nothing more is
    /// claimed, and no raw output is quoted in any error.
    read_failed: bool,
}

fn run_command_with(
    mut command: Command,
    options: RunOptions,
) -> Result<GitOutcome, WorktreeStatusError> {
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
        return Err(output_failure(0, 0));
    };
    let Some(stderr) = child.stderr.take() else {
        terminate(&mut child);
        return Err(output_failure(0, 0));
    };
    let stdout_reader = match spawn_reader("ticketry-git-stdout", stdout, options.max_output_bytes)
    {
        Ok(reader) => reader,
        Err(_) => {
            terminate(&mut child);
            return Err(output_failure(0, 0));
        }
    };
    let stderr_reader = match spawn_reader("ticketry-git-stderr", stderr, options.max_output_bytes)
    {
        Ok(reader) => reader,
        Err(_) => {
            terminate(&mut child);
            return Err(output_failure(0, 0));
        }
    };

    let status = wait_for_completion(
        &mut child,
        &stdout_reader,
        &stderr_reader,
        Instant::now() + options.timeout,
    )?;
    let stdout = join_reader(stdout_reader)?;
    let stderr = join_reader(stderr_reader)?;
    if stdout.read_failed || stderr.read_failed {
        return Err(output_failure(stdout.retained.len(), stderr.retained.len()));
    }
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
    max_output_bytes: usize,
) -> io::Result<thread::JoinHandle<io::Result<BoundedOutput>>>
where
    R: Read + Send + 'static,
{
    thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || drain_bounded(reader, max_output_bytes))
}

fn drain_bounded(mut reader: impl Read, max_output_bytes: usize) -> io::Result<BoundedOutput> {
    let mut retained = Vec::with_capacity(max_output_bytes);
    let mut truncated = false;
    let mut read_failed = false;
    let mut buffer = [0_u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let available = max_output_bytes.saturating_sub(retained.len());
                let keep = available.min(read);
                retained.extend_from_slice(&buffer[..keep]);
                truncated |= keep < read;
            }
            Err(_) => {
                read_failed = true;
                break;
            }
        }
    }
    Ok(BoundedOutput {
        retained,
        truncated,
        read_failed,
    })
}

/// A failed read is reported by length, never by quoting the bytes Git
/// produced; the lengths alone are safe evidence for diagnostics.
fn read_failure_message(stdout_bytes: usize, stderr_bytes: usize) -> String {
    format!(
        "Git output could not be read completely (stdout bytes retained: {stdout_bytes}, \
stderr bytes retained: {stderr_bytes})."
    )
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
        .map_err(|_| output_failure(0, 0))?
        .map_err(|_| output_failure(0, 0))
}

fn terminate(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn output_failure(stdout_bytes: usize, stderr_bytes: usize) -> WorktreeStatusError {
    WorktreeStatusError::git_unavailable(read_failure_message(stdout_bytes, stderr_bytes))
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
        let output = drain_bounded(std::io::Cursor::new(raw), MAX_OUTPUT_BYTES)
            .expect("drain bounded bytes");
        assert_eq!(output.retained.len(), MAX_OUTPUT_BYTES);
        assert!(output.truncated);
    }

    struct PartialThenError {
        reads: u32,
    }

    impl Read for PartialThenError {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.reads += 1;
            if self.reads == 1 {
                buffer[..12].copy_from_slice(b"partial-data");
                Ok(12)
            } else {
                Err(io::Error::new(io::ErrorKind::Other, "pipe collapsed"))
            }
        }
    }

    #[test]
    fn a_read_failure_reports_retained_lengths_not_output() {
        let output = drain_bounded(PartialThenError { reads: 0 }, 1024)
            .expect("the partial read is retained");

        assert_eq!(output.retained, b"partial-data");
        assert!(output.read_failed);
        assert_eq!(
            read_failure_message(12, 0),
            "Git output could not be read completely (stdout bytes retained: 12, stderr bytes retained: 0)."
        );
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

        let outcome =
            run_command_with(command, RunOptions::default()).expect("run bounded command");

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

        let error = run_command_with(
            command,
            RunOptions {
                timeout: Duration::from_millis(50),
                ..RunOptions::default()
            },
        )
        .expect_err("the command must time out");

        assert_eq!(
            error.code(),
            super::super::WorktreeStatusErrorCode::GitUnavailable
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn a_call_can_select_a_smaller_output_cap() {
        let mut command = Command::new("sh");
        command.args(["-c", "head -c 20000 /dev/zero"]);

        let outcome = run_command_with(
            command,
            RunOptions {
                max_output_bytes: 1024,
                ..RunOptions::default()
            },
        )
        .expect("run capped command");

        assert_eq!(outcome.stdout.len(), 1024);
        assert!(outcome.stdout_truncated);
    }

    #[cfg(unix)]
    #[test]
    fn a_call_can_select_a_shorter_timeout() {
        let mut command = Command::new("sh");
        command.args(["-c", "while :; do :; done"]);

        let error = run_command_with(
            command,
            RunOptions {
                timeout: Duration::from_millis(50),
                ..RunOptions::default()
            },
        )
        .expect_err("the command must time out");

        assert_eq!(
            error.code(),
            super::super::WorktreeStatusErrorCode::GitUnavailable
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_output_is_locale_stable_and_paths_are_not_quoted() {
        let directory = tempfile::tempdir().expect("create a fixture directory");
        let checkout = directory.path().join("checkout");
        std::fs::create_dir_all(&checkout).expect("create a checkout");
        let run = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(&checkout)
                .args(arguments)
                .output()
                .expect("run fixture git");
            assert!(output.status.success());
        };
        run(&["init", "-b", "main"]);
        run(&["config", "user.email", "test@ticketry.invalid"]);
        run(&["config", "user.name", "Ticketry Test"]);
        // With core.quotepath unset, Git prints this octal-escaped; the port's
        // -c core.quotepath=false must force the raw bytes through.
        std::fs::write(checkout.join("na\u{00ef}ve-\u{00e9}t\u{00e9}.txt"), "x\n")
            .expect("write a non-ASCII fixture file");

        let outcome = GitPort::new()
            .run(
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                &checkout,
            )
            .await
            .expect("Git itself is available");

        assert!(outcome.succeeded);
        assert!(
            outcome
                .stdout
                .contains("na\u{00ef}ve-\u{00e9}t\u{00e9}.txt"),
            "quotepath=false must print non-ASCII paths raw, got {:?}",
            outcome.stdout
        );
    }
}
