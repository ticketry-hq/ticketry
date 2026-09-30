//! Best-effort commit and pull-request message generation.
//!
//! The preferred generator comes from the existing provider settings; no
//! other preference store exists. Candidates run headlessly with bounded
//! output, closed stdin, a safe environment, and a hard deadline. Anything
//! unusable falls back to a deterministic template so generation can never
//! block a commit or pull-request action. File content, absolute paths,
//! prompts, raw process output, and secrets never enter returned values.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use sea_orm::DatabaseConnection;
use ticketry_settings::read_global_launch_default;

use crate::worktree::status::GitPort;

use super::ChangedFile;

const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(90);
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_SUBJECT_CHARS: usize = 72;
const MAX_BODY_CHARS: usize = 4000;
const COMMIT_PATCH_CHARS: usize = 12_000;
const PR_PATCH_CHARS: usize = 24_000;
const MAX_PROMPT_FILES: usize = 40;
const MAX_PROMPT_COMMITS: usize = 40;
const MAX_PR_PROMPT_FILES: usize = 60;

// opencode is not reachable through the runtime's provider discovery, so
// candidates are only claude, codex, and gemini.
pub(super) struct Generator {
    name: &'static str,
    approved_path_env: &'static str,
    binary: &'static str,
    prompt_arguments: &'static [&'static str],
}

impl Clone for Generator {
    fn clone(&self) -> Self {
        Generator {
            name: self.name,
            approved_path_env: self.approved_path_env,
            binary: self.binary,
            prompt_arguments: self.prompt_arguments,
        }
    }
}

const GENERATORS: [Generator; 3] = [
    Generator {
        name: "claude",
        approved_path_env: "MUXED_APPROVED_CLAUDE_PATH",
        binary: "claude",
        prompt_arguments: &["-p"],
    },
    Generator {
        name: "codex",
        approved_path_env: "MUXED_APPROVED_CODEX_PATH",
        binary: "codex",
        prompt_arguments: &["exec"],
    },
    Generator {
        name: "gemini",
        approved_path_env: "MUXED_APPROVED_GEMINI_PATH",
        binary: "gemini",
        prompt_arguments: &["-p"],
    },
];

pub(super) async fn read_preference(db: &DatabaseConnection) -> Option<&'static str> {
    let default = read_global_launch_default(db).await.ok()??;
    GENERATORS
        .iter()
        .find(|generator| generator.name == default.provider)
        .map(|generator| generator.name)
}

pub(super) fn candidate_sequence(preference: Option<&str>) -> Vec<Generator> {
    let mut candidates: Vec<Generator> = Vec::new();
    if let Some(name) = preference {
        if let Some(generator) = GENERATORS.iter().find(|g| g.name == name) {
            candidates.push(Generator {
                name: generator.name,
                approved_path_env: generator.approved_path_env,
                binary: generator.binary,
                prompt_arguments: generator.prompt_arguments,
            });
        }
    }
    for generator in &GENERATORS {
        if !candidates
            .iter()
            .any(|candidate| candidate.name == generator.name)
        {
            candidates.push(Generator {
                name: generator.name,
                approved_path_env: generator.approved_path_env,
                binary: generator.binary,
                prompt_arguments: generator.prompt_arguments,
            });
        }
    }
    candidates
}

fn approved_executable(generator: &Generator) -> Option<PathBuf> {
    match std::env::var(generator.approved_path_env) {
        Ok(value) if !value.trim().is_empty() => {
            let path = PathBuf::from(value);
            path.is_file().then_some(path)
        }
        _ => {
            let path = PathBuf::from(generator.binary);
            if path.is_absolute() {
                path.is_file().then_some(path)
            } else {
                which(&path).then_some(path)
            }
        }
    }
}

fn which(binary: &Path) -> bool {
    let Ok(path_value) = std::env::var("PATH") else {
        return false;
    };
    path_value
        .split(std::path::MAIN_SEPARATOR)
        .filter(|directory| !directory.is_empty())
        .any(|directory| Path::new(directory).join(binary).is_file())
}

fn run_generator(generator: &Generator, prompt: &str, checkout: &Path) -> Option<String> {
    run_generator_with(generator, prompt, checkout, ATTEMPT_TIMEOUT)
}

fn run_generator_with(
    generator: &Generator,
    prompt: &str,
    checkout: &Path,
    timeout: Duration,
) -> Option<String> {
    let Some(executable) = approved_executable(generator) else {
        return None;
    };
    let mut command = Command::new(executable);
    command
        .args(generator.prompt_arguments)
        .arg(prompt)
        .current_dir(checkout)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return None;
    };
    let reader = thread::Builder::new()
        .name("ticketry-generator-stdout".to_owned())
        .spawn(move || drain_bounded(stdout))
        .ok()?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Ok(Some(status)) = child.try_wait() {
            if reader.is_finished() {
                break status;
            }
        }
        let now = Instant::now();
        if now >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(WAIT_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    };
    if !status.success() {
        return None;
    }
    let outcome = reader.join().ok()?;
    let bounded = outcome.ok()?;
    if bounded.truncated {
        return None;
    }
    let answer = String::from_utf8_lossy(&bounded.retained).trim().to_owned();
    if answer.is_empty() {
        return None;
    }
    Some(answer)
}

struct BoundedOutput {
    retained: Vec<u8>,
    truncated: bool,
}

fn drain_bounded(mut reader: impl std::io::Read) -> std::io::Result<BoundedOutput> {
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

fn sanitize_subject(answer: &str) -> Option<String> {
    answer.lines().find_map(|line| {
        strip_packaging(line).and_then(|candidate| {
            let subject = capped(&candidate, MAX_SUBJECT_CHARS);
            (!subject.is_empty()).then_some(subject)
        })
    })
}

fn strip_packaging(line: &str) -> Option<String> {
    let mut candidate: String = line
        .trim()
        .trim_matches('"')
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .collect();
    const PREFIXES: [&str; 8] = [
        "Subject: ",
        "subject: ",
        "Title: ",
        "title: ",
        "- ",
        "* ",
        "### ",
        "## ",
    ];
    loop {
        let mut changed = false;
        for prefix in PREFIXES {
            if let Some(rest) = candidate.strip_prefix(prefix) {
                candidate = rest
                    .trim()
                    .trim_matches('"')
                    .trim()
                    .chars()
                    .filter(|c| !c.is_control())
                    .collect();
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    if candidate.starts_with(BACKTICKS_3) || candidate.starts_with(TILDES_3) {
        return None;
    }
    if candidate.is_empty() {
        return None;
    }
    Some(candidate)
}

const BACKTICKS_3: &str = "```";
const TILDES_3: &str = "~~~";

fn capped(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let mut cut = max_chars;
    while cut > 0 {
        let candidate: String = text.chars().take(cut).collect();
        if let Some(space) = candidate.rfind(' ') {
            let trimmed = candidate[..space].trim_end_matches(['.', ',', ';', ':', '-']);
            return trimmed.to_owned();
        }
        cut -= 1;
    }
    text.chars().take(max_chars).collect()
}

fn build_commit_prompt(files: &[ChangedFile], patch: &str) -> String {
    let mut prompt = String::from(
        "Write one Git commit subject line for these changes. Respond with the subject line only. Keep it at most 72 characters.
Files:
",
    );
    for file in files.iter().take(MAX_PROMPT_FILES) {
        prompt.push_str(&format!(
            "- {} {}
",
            file.status, file.path
        ));
    }
    if files.len() > MAX_PROMPT_FILES {
        prompt.push_str(&format!(
            "- and {} more
",
            files.len() - MAX_PROMPT_FILES
        ));
    }
    prompt.push_str(
        "Patch:
",
    );
    prompt.push_str(&patch.chars().take(COMMIT_PATCH_CHARS).collect::<String>());
    prompt
}

fn template_subject(files: &[ChangedFile]) -> String {
    match files {
        [] => "Update working tree".to_owned(),
        [only] => format!("{} {}", verb(&only.status), only.path),
        files => {
            let count = files.len();
            let noun = if count == 1 { "file" } else { "files" };
            match common_directory(files) {
                Some(directory) => format!("Update {count} {noun} in {directory}"),
                None => format!("Update {count} {noun}"),
            }
        }
    }
}

fn verb(status: &str) -> &'static str {
    match status {
        "added" => "Add",
        "deleted" => "Remove",
        "renamed" => "Rename",
        "copied" => "Copy",
        "conflicted" => "Resolve",
        _ => "Update",
    }
}

fn common_directory(files: &[ChangedFile]) -> Option<String> {
    let first = files.first()?;
    let mut common: Vec<std::path::Component<'_>> = Vec::new();
    'outer: for component in Path::new(&first.path).components() {
        for file in files {
            let mut path_components = Path::new(&file.path).components();
            for expected in &common {
                if path_components.next() != Some(*expected) {
                    continue 'outer;
                }
            }
            if path_components.next() != Some(component) {
                continue 'outer;
            }
        }
        common.push(component);
    }
    if common.is_empty() {
        return None;
    }
    let joined: PathBuf = common.iter().collect();
    let text = joined.to_string_lossy().into_owned();
    if text == "." || text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn sanitize_answer(answer: &str) -> Option<PullRequestText> {
    let usable: Vec<String> = answer.lines().filter_map(strip_packaging).collect();
    let title = capped(usable.first()?, MAX_SUBJECT_CHARS);
    if title.is_empty() {
        return None;
    }
    let mut body = String::new();
    for line in usable.iter().skip(1) {
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str(line);
    }
    Some(PullRequestText {
        title,
        body: sanitize_body(&body),
        source: "generator".to_owned(),
    })
}

fn sanitize_body(body: &str) -> String {
    let mut lines = Vec::new();
    for line in body.lines() {
        if line.trim().starts_with(BACKTICKS_3) || line.trim().starts_with(TILDES_3) {
            continue;
        }
        let cleaned: String = line
            .chars()
            .map(|c| if c == '\t' { ' ' } else { c })
            .filter(|c| !c.is_control())
            .collect();
        lines.push(cleaned);
    }
    capped(
        &lines.join(
            "
",
        ),
        MAX_BODY_CHARS,
    )
}

fn build_pr_prompt(
    branch: &str,
    base_branch: &str,
    commits: &[String],
    files: &[ChangedFile],
    patch: &str,
) -> String {
    let mut prompt = String::from(
        "Write a pull request title and body for these changes. The first line is the title and the rest is the body. Keep the title at most 72 characters.
Branch:
",
    );
    prompt.push_str(&format!(
        "{branch}
"
    ));
    prompt.push_str(&format!(
        "Merging into:
{base_branch}
"
    ));
    prompt.push_str(
        "Commits:
",
    );
    for subject in commits.iter().take(MAX_PROMPT_COMMITS) {
        prompt.push_str(&format!(
            "- {subject}
"
        ));
    }
    prompt.push_str(
        "Files:
",
    );
    for file in files.iter().take(MAX_PR_PROMPT_FILES) {
        prompt.push_str(&format!(
            "- {} {}
",
            file.status, file.path
        ));
    }
    prompt.push_str(
        "Patch:
",
    );
    prompt.push_str(&patch.chars().take(PR_PATCH_CHARS).collect::<String>());
    prompt
}

fn template_text(
    branch: &str,
    base: &str,
    commits: &[String],
    files: &[ChangedFile],
) -> PullRequestText {
    let title = match commits {
        [] => format!("Merge changes from {branch}"),
        [only] => capped(only, MAX_SUBJECT_CHARS),
        many => format!("Merge {} commits from {branch}", many.len()),
    };
    let mut body = format!("Merging {BT}{branch}{BT} into {BT}{base}{BT}.");
    body.push_str(
        "

## Commits",
    );
    if commits.is_empty() {
        body.push_str(
            "
(none recorded)",
        );
    } else {
        for subject in commits.iter().take(MAX_PROMPT_COMMITS) {
            body.push_str(&format!(
                "
- {subject}"
            ));
        }
    }
    body.push_str(
        "

## Files changed",
    );
    if files.is_empty() {
        body.push_str(
            "
(none recorded)",
        );
    } else {
        for file in files.iter().take(MAX_PR_PROMPT_FILES) {
            body.push_str(&format!(
                "
- {} {}",
                file.status, file.path
            ));
        }
    }
    PullRequestText {
        title,
        body: sanitize_body(&body),
        source: "template".to_owned(),
    }
}

const BT: &str = "`";

pub struct GeneratedMessage {
    pub subject: String,
    pub source: String,
}

pub struct PullRequestText {
    pub title: String,
    pub body: String,
    pub source: String,
}

/// Generate a commit subject from the candidates, falling back to a
/// deterministic template. Never errors and never panics on generator
/// failure; the runner receives the bounded prompt for one attempt.
pub fn generate_commit_subject_with(
    candidates: Vec<Generator>,
    files: &[ChangedFile],
    patch: &str,
    checkout: &Path,
    runner: &dyn Fn(&Generator, &str, &Path) -> Option<String>,
) -> GeneratedMessage {
    let prompt = build_commit_prompt(files, patch);
    for generator in &candidates {
        if let Some(answer) = runner(generator, &prompt, checkout) {
            if let Some(subject) = sanitize_subject(&answer) {
                return GeneratedMessage {
                    subject,
                    source: generator.name.to_owned(),
                };
            }
        }
    }
    GeneratedMessage {
        subject: template_subject(files),
        source: "template".to_owned(),
    }
}

pub(super) fn generate_commit_subject(
    candidates: Vec<Generator>,
    files: &[ChangedFile],
    patch: &str,
    checkout: &Path,
) -> GeneratedMessage {
    generate_commit_subject_with(
        candidates,
        files,
        patch,
        checkout,
        &|generator, prompt, dir| run_generator(generator, prompt, dir),
    )
}

/// Generate pull-request text from Git-derived inputs, falling back to a
/// deterministic template. Git-read failures degrade to empty metadata, so
/// PR creation still proceeds and is never blocked by generation.
pub(super) async fn generate_pr_text(
    git: &GitPort,
    db: &DatabaseConnection,
    checkout: &Path,
    branch: &str,
    base_branch: &str,
    base_reference: &str,
) -> PullRequestText {
    let preference = read_preference(db).await;
    let candidates = candidate_sequence(preference);
    let commits = commit_subjects(git, checkout, base_reference).await;
    let files = changed_files(git, checkout, base_reference).await;
    let patch = bounded_patch(git, checkout, base_reference).await;
    generate_pr_text_with(
        candidates,
        branch,
        base_branch,
        &commits,
        &files,
        &patch,
        &|generator, prompt, dir| run_generator(generator, prompt, dir),
    )
}

fn generate_pr_text_with(
    candidates: Vec<Generator>,
    branch: &str,
    base_branch: &str,
    commits: &[String],
    files: &[ChangedFile],
    patch: &str,
    runner: &dyn Fn(&Generator, &str, &Path) -> Option<String>,
) -> PullRequestText {
    let prompt = build_pr_prompt(branch, base_branch, commits, files, patch);
    for generator in &candidates {
        if let Some(answer) = runner(generator, &prompt, Path::new(".")) {
            if let Some(text) = sanitize_answer(&answer) {
                return PullRequestText {
                    source: generator.name.to_owned(),
                    ..text
                };
            }
        }
    }
    template_text(branch, base_branch, commits, files)
}

async fn commit_subjects(git: &GitPort, checkout: &Path, base: &str) -> Vec<String> {
    let range = format!("{base}..HEAD");
    let Ok(outcome) = git
        .run(&["log", "--max-count=40", "--format=%s", &range], checkout)
        .await
    else {
        return Vec::new();
    };
    if !outcome.succeeded {
        return Vec::new();
    }
    outcome
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

async fn changed_files(git: &GitPort, checkout: &Path, base: &str) -> Vec<ChangedFile> {
    let Ok(outcome) = git
        .run(
            &[
                "diff",
                "--name-status",
                "-z",
                "--find-renames",
                "--no-ext-diff",
                "--no-textconv",
                base,
                "--",
            ],
            checkout,
        )
        .await
    else {
        return Vec::new();
    };
    if !outcome.succeeded {
        return Vec::new();
    }
    let mut files = Vec::new();
    let mut fields = outcome.stdout.split('\0');
    while let Some(kind) = fields.next() {
        let Some(path) = fields.next() else { break };
        let path = if kind.starts_with('R') || kind.starts_with('C') {
            match fields.next() {
                Some(current) => current,
                None => break,
            }
        } else {
            path
        };
        if path.is_empty() {
            continue;
        }
        files.push(ChangedFile {
            path: path.to_owned(),
            previous_path: None,
            status: diff_status(kind).to_owned(),
            binary: false,
            insertions: None,
            deletions: None,
        });
    }
    files.truncate(MAX_PR_PROMPT_FILES);
    files
}

fn diff_status(kind: &str) -> &'static str {
    match kind.chars().next() {
        Some('A') => "added",
        Some('D') => "deleted",
        Some('R') => "renamed",
        Some('C') => "copied",
        Some('U') => "conflicted",
        _ => "modified",
    }
}

pub(super) async fn bounded_patch(git: &GitPort, checkout: &Path, base: &str) -> String {
    let Ok(outcome) = git
        .run(
            &["diff", "--no-ext-diff", "--no-textconv", base, "--"],
            checkout,
        )
        .await
    else {
        return String::new();
    };
    if !outcome.succeeded {
        return String::new();
    }
    outcome.stdout.chars().take(PR_PATCH_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, status: &str) -> ChangedFile {
        ChangedFile {
            path: path.to_owned(),
            previous_path: None,
            status: status.to_owned(),
            binary: false,
            insertions: None,
            deletions: None,
        }
    }

    fn runner(
        candidates: &'static [&'static str],
    ) -> impl Fn(&Generator, &str, &Path) -> Option<String> {
        let names: Vec<&str> = candidates.to_vec();
        move |generator, _prompt, _checkout| {
            names
                .iter()
                .find(|name| **name == generator.name)
                .map(|name| format!("{name} answer"))
        }
    }

    #[test]
    fn preference_comes_first_without_repeats() {
        let sequence = candidate_sequence(Some("gemini"));
        let names: Vec<&str> = sequence.iter().map(|g| g.name).collect();
        assert_eq!(names, vec!["gemini", "claude", "codex"]);
    }

    #[test]
    fn unknown_preference_is_ignored() {
        let sequence = candidate_sequence(Some("mystery"));
        let names: Vec<&str> = sequence.iter().map(|g| g.name).collect();
        assert_eq!(names, vec!["claude", "codex", "gemini"]);
    }

    #[test]
    fn unusable_answers_fall_through_to_template() {
        let candidates = candidate_sequence(None);
        let unusable = |_: &Generator, _: &str, _: &Path| {
            Some(
                "```
```
```"
                .to_owned(),
            )
        };
        let generated = generate_commit_subject_with(
            candidates.clone(),
            &[file("a.txt", "modified")],
            "patch",
            Path::new("."),
            &unusable,
        );
        assert_eq!(generated.subject, "Update a.txt");
        assert_eq!(generated.source, "template");
    }

    #[test]
    fn single_file_template_uses_verb_and_path() {
        assert_eq!(template_subject(&[file("new.txt", "added")]), "Add new.txt");
    }

    #[test]
    fn multi_file_template_lists_common_directory() {
        let files = vec![file("src/a.rs", "modified"), file("src/b.rs", "added")];
        assert_eq!(template_subject(&files), "Update 2 files in src");
    }

    #[test]
    fn subject_is_capped_at_72_chars() {
        let words: Vec<&str> = (0..40).map(|_| "word").collect();
        let long = words.join(" ");
        let subject = sanitize_subject(&long);
        assert!(subject.is_some());
        let subject = subject.unwrap();
        assert!(subject.chars().count() <= 72);
        assert!(!subject.ends_with(' '));
    }

    #[test]
    fn packaging_is_stripped() {
        assert_eq!(
            strip_packaging("Subject: Add thing"),
            Some("Add thing".to_owned())
        );
        assert_eq!(strip_packaging("- Add thing"), Some("Add thing".to_owned()));
        assert_eq!(strip_packaging("```rust"), None);
    }

    #[test]
    fn missing_binary_returns_none() {
        let missing = Generator {
            name: "missing",
            approved_path_env: "MUXED_TEST_MISSING_BIN_PATH",
            binary: "ticketry-definitely-missing-bin",
            prompt_arguments: &[],
        };
        assert!(run_generator_with(
            &missing,
            "prompt",
            Path::new("."),
            Duration::from_millis(50)
        )
        .is_none());
    }

    #[test]
    fn failing_exit_returns_none() {
        let failing = Generator {
            name: "failing",
            approved_path_env: "MUXED_TEST_FAILING_BIN_PATH",
            binary: "false",
            prompt_arguments: &[],
        };
        assert!(
            run_generator_with(&failing, "prompt", Path::new("."), Duration::from_secs(5))
                .is_none()
        );
    }

    #[test]
    fn timed_out_binary_returns_none() {
        let script_dir = std::env::temp_dir().join("ticketry-msggen-tests");
        std::fs::create_dir_all(&script_dir).unwrap();
        let script = script_dir.join("slow-bin");
        std::fs::write(
            &script,
            "#!/bin/sh
sleep 5
",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&script).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&script, permissions).unwrap();
        }
        let slow = Generator {
            name: "slow",
            approved_path_env: "MUXED_TEST_SLOW_BIN_PATH",
            binary: Box::leak(script.to_string_lossy().into_owned().into_boxed_str()),
            prompt_arguments: &[],
        };
        assert!(
            run_generator_with(&slow, "prompt", Path::new("."), Duration::from_millis(100))
                .is_none()
        );
    }

    #[test]
    fn template_is_deterministic() {
        let files = vec![file("a.rs", "modified"), file("b.rs", "modified")];
        let first = template_subject(&files);
        let second = template_subject(&files);
        assert_eq!(first, second);
    }

    #[test]
    fn pr_answer_title_and_body_are_sanitized() {
        let text = sanitize_answer("```\n\"Title\"\nBody line.\n```\n").unwrap();
        assert_eq!(text.title, "Title");
        assert_eq!(text.body, "Body line.");
        assert_eq!(text.source, "generator");
    }

    #[test]
    fn pr_template_lists_commits_and_files() {
        let text = template_text(
            "feature",
            "main",
            &["Add feature".to_owned()],
            &[file("src/lib.rs", "modified")],
        );
        assert_eq!(text.title, "Add feature");
        assert!(text.body.contains("Merging `feature` into `main`"));
        assert!(text.body.contains("## Commits"));
        assert!(text.body.contains("## Files changed"));
        assert_eq!(text.source, "template");
    }

    #[test]
    fn generation_falls_back_when_runners_unavailable() {
        let candidates = candidate_sequence(Some("claude"));
        let none = |_: &Generator, _: &str, _: &Path| None;
        let generated = generate_commit_subject_with(
            candidates,
            &[file("a.rs", "modified")],
            "patch",
            Path::new("."),
            &none,
        );
        assert_eq!(generated.subject, "Update a.rs");
        assert_eq!(generated.source, "template");
    }

    #[test]
    fn non_blocking_generation_never_panics() {
        // The generation path must never panic or propagate an error when the
        // generator binary is missing, timing out, or producing garbage.
        let candidates = candidate_sequence(None);
        let garbage = |_: &Generator, _: &str, _: &Path| Some("\u{7}\u{7}\n\n".to_owned());
        let generated = generate_commit_subject_with(
            candidates.clone(),
            &[file("a.rs", "modified")],
            "patch",
            Path::new("."),
            &garbage,
        );
        assert_eq!(generated.subject, "Update a.rs");
        assert_eq!(generated.source, "template");
    }
}
