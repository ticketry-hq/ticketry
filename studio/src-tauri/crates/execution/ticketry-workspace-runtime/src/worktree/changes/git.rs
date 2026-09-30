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
    let status = super::command_git::status(git, checkout).await?;
    cumulative_from_status(git, checkout, base_commit, &status).await
}

pub(super) async fn cumulative_from_status(
    git: &GitPort,
    checkout: &Path,
    base_commit: &str,
    status: &GitOutcome,
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
    require_path_bytes(status)?;
    if !status.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not read this checkout's current state.",
        ));
    }

    let mut files = BTreeMap::new();
    parse_name_status(&diff, &mut files)?;
    merge_unmerged(&unmerged, &mut files)?;
    merge_status(status, &mut files)?;
    let list_truncated = files.len() > MAX_CHANGED_FILES;
    let numstat = git
        .run(
            &[
                "diff",
                "--numstat",
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
    require_path_bytes(&numstat)?;
    if !numstat.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not read changed-file counts.",
        ));
    }
    parse_numstat(&numstat, &mut files)?;
    count_untracked(&mut files, checkout);
    Ok(CumulativeChanges {
        files: files.into_values().take(MAX_CHANGED_FILES).collect(),
        truncated: diff.stdout_truncated
            || unmerged.stdout_truncated
            || status.stdout_truncated
            || list_truncated,
    })
}

/// Untracked files never appear in numstat, so their counts come from a small
// read of the working file. A single NUL marks binary content.
fn count_untracked(files: &mut BTreeMap<String, ChangedFile>, checkout: &Path) {
    for (_, file) in files
        .iter_mut()
        .filter(|(_, file)| file.status == "untracked" && file.insertions.is_none())
    {
        let path = checkout.join(&file.path);
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file() {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let binary = bytes[..bytes.len().min(8000)].contains(&0);
        let lines = if binary {
            0
        } else {
            bytes.iter().filter(|byte| **byte == b'\n').count()
                + usize::from(!bytes.is_empty() && bytes.last() != Some(&b'\n'))
        };
        file.binary = binary;
        file.insertions = Some(lines.min(i32::MAX as usize) as i32);
        file.deletions = Some(0);
    }
}

fn parse_numstat(
    outcome: &GitOutcome,
    files: &mut BTreeMap<String, ChangedFile>,
) -> Result<(), WorktreeChangesError> {
    if outcome.stdout_truncated || (!outcome.stdout.is_empty() && !outcome.stdout.ends_with('\0')) {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git returned an incomplete changed-file count stream.",
        ));
    }
    let records = outcome.stdout.split_terminator('\0').collect::<Vec<_>>();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        index += 1;
        let mut parts = record.split('\t');
        let added = parts.next().unwrap_or_default();
        let removed = parts.next().unwrap_or_default();
        let path_field = parts.next().unwrap_or_default();
        if added.is_empty() || removed.is_empty() {
            return Err(WorktreeChangesError::git_state_unavailable(
                "Git returned an incomplete changed-file count record.",
            ));
        }
        let binary = added == "-" || removed == "-";
        let (insertions, deletions) = if binary {
            (None, None)
        } else {
            let insertions = added.parse::<i32>().map_err(|_| {
                WorktreeChangesError::git_state_unavailable(
                    "Git returned an unreadable changed-file count record.",
                )
            })?;
            let deletions = removed.parse::<i32>().map_err(|_| {
                WorktreeChangesError::git_state_unavailable(
                    "Git returned an unreadable changed-file count record.",
                )
            })?;
            (Some(insertions), Some(deletions))
        };
        let path = if path_field.is_empty() {
            let _original = records.get(index).ok_or_else(|| {
                WorktreeChangesError::git_state_unavailable(
                    "Git returned an incomplete renamed-file count record.",
                )
            })?;
            let current = records.get(index + 1).ok_or_else(|| {
                WorktreeChangesError::git_state_unavailable(
                    "Git returned an incomplete renamed-file count record.",
                )
            })?;
            index += 2;
            (*current).to_owned()
        } else {
            path_field.to_owned()
        };
        if let Some(file) = files.get_mut(&path) {
            file.binary = binary;
            file.insertions = insertions;
            file.deletions = deletions;
        }
    }
    Ok(())
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
                binary: false,
                insertions: None,
                deletions: None,
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
                binary: false,
                insertions: None,
                deletions: None,
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
                    binary: false,
                    insertions: None,
                    deletions: None,
                });
        } else if code == "??" {
            files.entry(path.to_owned()).or_insert_with(|| ChangedFile {
                path: path.to_owned(),
                previous_path: None,
                status: "untracked".to_owned(),
                binary: false,
                insertions: None,
                deletions: None,
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
    fn numstat_sets_counts_and_binary_state() {
        let mut files = BTreeMap::from([
            (
                "changed.txt".to_owned(),
                ChangedFile {
                    path: "changed.txt".to_owned(),
                    previous_path: None,
                    status: "modified".to_owned(),
                    binary: false,
                    insertions: None,
                    deletions: None,
                },
            ),
            (
                "image.png".to_owned(),
                ChangedFile {
                    path: "image.png".to_owned(),
                    previous_path: None,
                    status: "modified".to_owned(),
                    binary: false,
                    insertions: None,
                    deletions: None,
                },
            ),
        ]);
        let outcome = outcome("3\t1\tchanged.txt\0-\t-\timage.png\0", false, true);

        parse_numstat(&outcome, &mut files).expect("valid numstat");

        assert_eq!(files["changed.txt"].insertions, Some(3));
        assert_eq!(files["changed.txt"].deletions, Some(1));
        assert!(files["image.png"].binary);
        assert_eq!(files["image.png"].insertions, None);
    }

    #[test]
    fn truncated_numstat_is_rejected() {
        let mut files = BTreeMap::new();
        let error = parse_numstat(&outcome("3\t1\tpartial", true, true), &mut files)
            .expect_err("truncated numstat must fail");

        assert_eq!(error.code_str(), "worktree_changes_git_unavailable");
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
