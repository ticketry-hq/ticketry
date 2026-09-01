//! Bounded, non-interactive access to the user's existing `gh` login.

use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::WorktreeChangesError;

const APPROVED_PATH_ENV: &str = "MUXED_APPROVED_GH_PATH";
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);
const CREATE_TIMEOUT: Duration = Duration::from_secs(120);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Copy, Debug, Default)]
pub struct GithubPort;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequest {
    pub(super) state: String,
    #[serde(rename = "baseRefName")]
    pub(super) base_branch: String,
    #[serde(rename = "headRefOid")]
    pub(super) head_commit: String,
    pub(super) mergeable: String,
    pub(super) review_decision: Option<String>,
    #[serde(default)]
    pub(super) required_check_buckets: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRequiredCheck {
    bucket: String,
}

impl GithubPort {
    pub fn new() -> Self {
        Self
    }

    pub(super) async fn require_authenticated(
        &self,
        checkout: &Path,
    ) -> Result<(), WorktreeChangesError> {
        let outcome = self
            .run(
                vec!["auth".to_owned(), "status".to_owned()],
                checkout,
                AUTH_TIMEOUT,
            )
            .await?;
        if outcome.succeeded {
            Ok(())
        } else {
            Err(WorktreeChangesError::github_authentication_failed())
        }
    }

    pub(super) async fn create_pull_request(
        &self,
        checkout: &Path,
        branch: &str,
        base_branch: &str,
        title: &str,
        body: &str,
    ) -> Result<String, WorktreeChangesError> {
        let outcome = self
            .run(
                vec![
                    "pr".to_owned(),
                    "create".to_owned(),
                    "--base".to_owned(),
                    base_branch.to_owned(),
                    "--head".to_owned(),
                    branch.to_owned(),
                    "--title".to_owned(),
                    title.to_owned(),
                    "--body".to_owned(),
                    body.to_owned(),
                ],
                checkout,
                CREATE_TIMEOUT,
            )
            .await?;
        if !outcome.succeeded {
            return Err(WorktreeChangesError::github_rejected());
        }
        if outcome.truncated || !outcome.valid_utf8 {
            return Err(WorktreeChangesError::github_response_unavailable());
        }
        canonical_pull_request_url(&outcome.stdout)
            .ok_or_else(WorktreeChangesError::github_response_unavailable)
    }

    pub async fn pull_request(
        &self,
        checkout: &Path,
        url: &str,
    ) -> Result<GithubPullRequest, WorktreeChangesError> {
        let outcome = self
            .run(
                vec![
                    "pr".to_owned(),
                    "view".to_owned(),
                    url.to_owned(),
                    "--json".to_owned(),
                    "state,baseRefName,headRefOid,mergeable,reviewDecision".to_owned(),
                ],
                checkout,
                READ_TIMEOUT,
            )
            .await?;
        if !outcome.succeeded || outcome.truncated || !outcome.valid_utf8 {
            return Err(WorktreeChangesError::github_status_unavailable());
        }
        let mut pull_request: GithubPullRequest = serde_json::from_str(&outcome.stdout)
            .map_err(|_| WorktreeChangesError::github_status_unavailable())?;
        if pull_request.review_decision.as_deref() == Some("") {
            pull_request.review_decision = None;
        }
        if !valid_pull_request(&pull_request) {
            return Err(WorktreeChangesError::github_status_unavailable());
        }
        if pull_request.state == "OPEN" {
            let checks = self
                .run(
                    vec![
                        "pr".to_owned(),
                        "checks".to_owned(),
                        url.to_owned(),
                        "--required".to_owned(),
                        "--json".to_owned(),
                        "bucket".to_owned(),
                    ],
                    checkout,
                    READ_TIMEOUT,
                )
                .await?;
            if checks.truncated || !checks.valid_utf8 {
                return Err(WorktreeChangesError::github_status_unavailable());
            }
            let checks: Vec<GithubRequiredCheck> = if checks.stdout.trim().is_empty()
                && !checks.succeeded
                && checks.stderr.contains("no required checks reported on the")
            {
                Vec::new()
            } else {
                serde_json::from_str(&checks.stdout)
                    .map_err(|_| WorktreeChangesError::github_status_unavailable())?
            };
            if checks.iter().any(|check| {
                !matches!(
                    check.bucket.as_str(),
                    "pass" | "fail" | "pending" | "skipping" | "cancel"
                )
            }) {
                return Err(WorktreeChangesError::github_status_unavailable());
            }
            pull_request.required_check_buckets =
                checks.into_iter().map(|check| check.bucket).collect();
        }
        Ok(pull_request)
    }

    async fn run(
        &self,
        arguments: Vec<String>,
        checkout: &Path,
        timeout: Duration,
    ) -> Result<GithubOutcome, WorktreeChangesError> {
        let executable = approved_executable()?;
        let checkout = checkout.to_owned();
        tokio::task::spawn_blocking(move || run_command(executable, arguments, checkout, timeout))
            .await
            .map_err(|_| WorktreeChangesError::github_unavailable())?
    }
}

fn valid_pull_request(pull_request: &GithubPullRequest) -> bool {
    matches!(pull_request.state.as_str(), "OPEN" | "CLOSED" | "MERGED")
        && !pull_request.base_branch.trim().is_empty()
        && matches!(
            pull_request.mergeable.as_str(),
            "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
        )
        && pull_request
            .review_decision
            .as_deref()
            .is_none_or(|decision| {
                matches!(
                    decision,
                    "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED"
                )
            })
        && matches!(pull_request.head_commit.len(), 40 | 64)
        && pull_request
            .head_commit
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
}

struct GithubOutcome {
    succeeded: bool,
    stdout: String,
    stderr: String,
    truncated: bool,
    valid_utf8: bool,
}

struct BoundedOutput {
    retained: Vec<u8>,
    truncated: bool,
}

fn approved_executable() -> Result<PathBuf, WorktreeChangesError> {
    match std::env::var(APPROVED_PATH_ENV) {
        Ok(value) if !value.trim().is_empty() => {
            let path = PathBuf::from(value);
            if path.is_file() {
                Ok(path)
            } else {
                Err(WorktreeChangesError::github_unavailable())
            }
        }
        _ => Ok(PathBuf::from("gh")),
    }
}

fn run_command(
    executable: PathBuf,
    arguments: Vec<String>,
    checkout: PathBuf,
    timeout: Duration,
) -> Result<GithubOutcome, WorktreeChangesError> {
    let mut command = Command::new(executable);
    command
        .args(arguments)
        .current_dir(checkout)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PAGER", "cat")
        .env("PAGER", "cat")
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| WorktreeChangesError::github_unavailable())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(WorktreeChangesError::github_unavailable)?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(WorktreeChangesError::github_unavailable)?;
    let stdout_reader = spawn_reader("ticketry-gh-stdout", stdout)?;
    let stderr_reader = spawn_reader("ticketry-gh-stderr", stderr)?;
    let status = wait_for_completion(
        &mut child,
        &stdout_reader,
        &stderr_reader,
        Instant::now() + timeout,
    )?;
    let stdout = join_reader(stdout_reader)?;
    let stderr = join_reader(stderr_reader)?;
    Ok(GithubOutcome {
        succeeded: status.success(),
        valid_utf8: std::str::from_utf8(&stdout.retained).is_ok()
            && std::str::from_utf8(&stderr.retained).is_ok(),
        stdout: String::from_utf8_lossy(&stdout.retained).into_owned(),
        stderr: String::from_utf8_lossy(&stderr.retained).into_owned(),
        truncated: stdout.truncated || stderr.truncated,
    })
}

fn spawn_reader<R>(
    name: &str,
    reader: R,
) -> Result<thread::JoinHandle<io::Result<BoundedOutput>>, WorktreeChangesError>
where
    R: Read + Send + 'static,
{
    thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || drain_bounded(reader))
        .map_err(|_| WorktreeChangesError::github_unavailable())
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

fn wait_for_completion(
    child: &mut std::process::Child,
    stdout: &thread::JoinHandle<io::Result<BoundedOutput>>,
    stderr: &thread::JoinHandle<io::Result<BoundedOutput>>,
    deadline: Instant,
) -> Result<ExitStatus, WorktreeChangesError> {
    loop {
        let status = child
            .try_wait()
            .map_err(|_| WorktreeChangesError::github_unavailable())?;
        if let Some(status) = status {
            if stdout.is_finished() && stderr.is_finished() {
                return Ok(status);
            }
        }
        let now = Instant::now();
        if now >= deadline {
            terminate(child);
            return Err(WorktreeChangesError::github_timed_out());
        }
        thread::sleep(WAIT_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    }
}

fn join_reader(
    reader: thread::JoinHandle<io::Result<BoundedOutput>>,
) -> Result<BoundedOutput, WorktreeChangesError> {
    reader
        .join()
        .map_err(|_| WorktreeChangesError::github_unavailable())?
        .map_err(|_| WorktreeChangesError::github_unavailable())
}

fn terminate(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn canonical_pull_request_url(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|candidate| {
        let candidate = candidate.trim_matches(|character: char| {
            matches!(character, '\'' | '"' | '<' | '>' | '(' | ')' | ',' | ';')
        });
        let mut url = reqwest::Url::parse(candidate).ok()?;
        if url.scheme() != "https" || url.host_str() != Some("github.com") {
            return None;
        }
        let segments = url.path_segments()?.collect::<Vec<_>>();
        let number = segments.get(3)?;
        if segments.len() != 4
            || segments[0].is_empty()
            || segments[1].is_empty()
            || segments[2] != "pull"
            || !number.chars().all(|character| character.is_ascii_digit())
        {
            return None;
        }
        url.set_query(None);
        url.set_fragment(None);
        Some(url.to_string().trim_end_matches('/').to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_canonical_https_pull_request_urls() {
        assert_eq!(
            canonical_pull_request_url("https://github.com/ticketry-hq/ticketry/pull/1324\n"),
            Some("https://github.com/ticketry-hq/ticketry/pull/1324".to_owned())
        );
        assert_eq!(
            canonical_pull_request_url("https://example.com/not-a-pr"),
            None
        );
        assert_eq!(
            canonical_pull_request_url("https://example.com/a/b/pull/1"),
            None
        );
        assert_eq!(
            canonical_pull_request_url("http://github.com/a/b/pull/1"),
            None
        );
    }
}
