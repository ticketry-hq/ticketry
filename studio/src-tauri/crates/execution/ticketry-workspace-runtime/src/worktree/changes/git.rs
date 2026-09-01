use std::collections::BTreeMap;
use std::path::{Component, Path};

use crate::worktree::status::{GitOutcome, GitPort};

use super::{ChangedFile, WorktreeChangesError};

const MAX_CHANGED_FILES: usize = 500;

pub(super) struct CumulativeChanges {
    pub(super) files: Vec<ChangedFile>,
    pub(super) truncated: bool,
}

pub(super) async fn cumulative(
    git: &GitPort,
    checkout: &Path,
    base_commit: &str,
) -> Result<CumulativeChanges, WorktreeChangesError> {
    let diff = git
        .run(
            &[
                "diff",
                "--name-status",
                "-z",
                "--find-renames",
                "--find-copies-harder",
                "--no-ext-diff",
                "--no-textconv",
                base_commit,
                "--",
            ],
            checkout,
        )
        .await?;
    require_path_bytes(&diff)?;
    if !diff.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not compare this checkout with its recorded base commit.",
        ));
    }
    let unmerged = git
        .run(
            &["diff", "--name-only", "--diff-filter=U", "-z", "--"],
            checkout,
        )
        .await?;
    require_path_bytes(&unmerged)?;
    if !unmerged.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not read this checkout's unmerged paths.",
        ));
    }
    let status = git
        .run(
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            checkout,
        )
        .await?;
    require_path_bytes(&status)?;
    if !status.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not read this checkout's current state.",
        ));
    }

    let mut files = BTreeMap::new();
    parse_name_status(&diff, &mut files)?;
    merge_unmerged(&unmerged, &mut files)?;
    merge_status(&status, &mut files)?;
    let list_truncated = files.len() > MAX_CHANGED_FILES;
    Ok(CumulativeChanges {
        files: files.into_values().take(MAX_CHANGED_FILES).collect(),
        truncated: diff.stdout_truncated
            || unmerged.stdout_truncated
            || status.stdout_truncated
            || list_truncated,
    })
}

fn merge_unmerged(
    outcome: &GitOutcome,
    files: &mut BTreeMap<String, ChangedFile>,
) -> Result<(), WorktreeChangesError> {
    for path in complete_records(outcome).split_terminator('\0') {
        validate_path(path)?;
        files
            .entry(path.to_owned())
            .and_modify(|file| file.status = "conflicted".to_owned())
            .or_insert_with(|| ChangedFile {
                path: path.to_owned(),
                previous_path: None,
                status: "conflicted".to_owned(),
            });
    }
    Ok(())
}

fn parse_name_status(
    outcome: &GitOutcome,
    files: &mut BTreeMap<String, ChangedFile>,
) -> Result<(), WorktreeChangesError> {
    let mut fields = complete_records(outcome).split_terminator('\0');
    while let Some(kind) = fields.next() {
        let Some(path) = fields.next() else {
            return incomplete_or_truncated(outcome);
        };
        let (previous_path, path) = if kind.starts_with('R') || kind.starts_with('C') {
            let Some(current) = fields.next() else {
                return incomplete_or_truncated(outcome);
            };
            validate_path(path)?;
            (Some(path.to_owned()), current.to_owned())
        } else {
            (None, path.to_owned())
        };
        validate_path(&path)?;
        let status = diff_status(kind)?;
        files.insert(
            path.clone(),
            ChangedFile {
                path,
                previous_path,
                status: status.to_owned(),
            },
        );
    }
    Ok(())
}

fn merge_status(
    outcome: &GitOutcome,
    files: &mut BTreeMap<String, ChangedFile>,
) -> Result<(), WorktreeChangesError> {
    let mut records = complete_records(outcome).split_terminator('\0');
    while let Some(record) = records.next() {
        let bytes = record.as_bytes();
        if bytes.len() < 4 || bytes[2] != b' ' {
            return Err(invalid_git_record());
        }
        let code = &record[..2];
        if !is_porcelain_status(code) {
            return Err(invalid_git_record());
        }
        let path = &record[3..];
        validate_path(path)?;

        if matches!(bytes[0], b'R' | b'C') || matches!(bytes[1], b'R' | b'C') {
            let Some(previous_path) = records.next() else {
                return incomplete_or_truncated(outcome);
            };
            validate_path(previous_path)?;
        }

        if is_conflict(code) {
            files
                .entry(path.to_owned())
                .and_modify(|file| file.status = "conflicted".to_owned())
                .or_insert_with(|| ChangedFile {
                    path: path.to_owned(),
                    previous_path: None,
                    status: "conflicted".to_owned(),
                });
        } else if code == "??" {
            files.entry(path.to_owned()).or_insert_with(|| ChangedFile {
                path: path.to_owned(),
                previous_path: None,
                status: "untracked".to_owned(),
            });
        }
    }
    Ok(())
}

fn is_conflict(code: &str) -> bool {
    matches!(code, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU")
}

fn diff_status(kind: &str) -> Result<&'static str, WorktreeChangesError> {
    match kind {
        "A" => Ok("added"),
        "D" => Ok("deleted"),
        "M" | "T" => Ok("modified"),
        "U" => Ok("conflicted"),
        _ if scored_status(kind, 'R') => Ok("renamed"),
        _ if scored_status(kind, 'C') => Ok("copied"),
        _ => Err(invalid_git_record()),
    }
}

fn scored_status(kind: &str, prefix: char) -> bool {
    kind.strip_prefix(prefix)
        .is_some_and(|score| !score.is_empty() && score.bytes().all(|byte| byte.is_ascii_digit()))
}

fn is_porcelain_status(code: &str) -> bool {
    if is_conflict(code) || matches!(code, "??" | "!!") {
        return true;
    }
    let bytes = code.as_bytes();
    bytes.len() == 2
        && matches!(bytes[0], b' ' | b'M' | b'T' | b'A' | b'D' | b'R' | b'C')
        && matches!(bytes[1], b' ' | b'M' | b'T' | b'D' | b'R' | b'C')
        && code != "  "
}

fn require_path_bytes(outcome: &GitOutcome) -> Result<(), WorktreeChangesError> {
    if outcome.stdout_valid_utf8 {
        Ok(())
    } else {
        Err(WorktreeChangesError::invalid_path())
    }
}

fn validate_path(value: &str) -> Result<(), WorktreeChangesError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(WorktreeChangesError::invalid_path());
    }
    Ok(())
}

fn complete_records(outcome: &GitOutcome) -> &str {
    if !outcome.stdout_truncated || outcome.stdout.ends_with('\0') {
        return &outcome.stdout;
    }
    outcome
        .stdout
        .rfind('\0')
        .map(|end| &outcome.stdout[..=end])
        .unwrap_or("")
}

fn incomplete_or_truncated(outcome: &GitOutcome) -> Result<(), WorktreeChangesError> {
    if outcome.stdout_truncated {
        Ok(())
    } else {
        Err(invalid_git_record())
    }
}

fn invalid_git_record() -> WorktreeChangesError {
    WorktreeChangesError::git_state_unavailable("Git returned an incomplete changed-file record.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(stdout: &str, truncated: bool, valid_utf8: bool) -> GitOutcome {
        GitOutcome {
            succeeded: true,
            stdout: stdout.to_owned(),
            stdout_truncated: truncated,
            stdout_valid_utf8: valid_utf8,
            stderr: String::new(),
        }
    }

    #[test]
    fn lossy_git_path_output_is_rejected_before_parsing() {
        let error = require_path_bytes(&outcome("?? invalid-�.txt\0", false, false))
            .expect_err("lossy path output must fail");

        assert_eq!(error.code_str(), "worktree_changes_invalid_path");
    }

    #[test]
    fn a_truncated_status_record_is_never_returned_as_a_path() {
        let output = outcome("?? complete.txt\0?? partial", true, true);
        let mut files = BTreeMap::new();

        merge_status(&output, &mut files).expect("complete records remain usable");

        assert_eq!(files.len(), 1);
        assert!(files.contains_key("complete.txt"));
        assert!(!files.contains_key("partial"));
    }

    #[test]
    fn exact_base_unmerged_status_is_conflicted_without_porcelain_help() {
        let output = outcome("U\0late-conflict.txt\0", false, true);
        let mut files = BTreeMap::new();

        parse_name_status(&output, &mut files).expect("parse exact-base conflict");

        assert_eq!(files["late-conflict.txt"].status, "conflicted");
    }

    #[test]
    fn unknown_complete_diff_and_status_tokens_are_rejected() {
        let mut files = BTreeMap::new();
        let diff_error = parse_name_status(&outcome("X\0unknown.txt\0", false, true), &mut files)
            .expect_err("unknown diff status must fail");
        assert_eq!(diff_error.code_str(), "worktree_changes_git_unavailable");

        let status_error = merge_status(&outcome("x\0", true, true), &mut files)
            .expect_err("complete malformed status must fail even when later output is truncated");
        assert_eq!(status_error.code_str(), "worktree_changes_git_unavailable");
    }
}
