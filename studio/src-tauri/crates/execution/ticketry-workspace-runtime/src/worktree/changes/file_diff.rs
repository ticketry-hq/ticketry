use std::path::Path;

use seaography::CustomOutputType;
use serde::Serialize;

use crate::worktree::status::{GitPort, RunOptions};

use super::WorktreeChangesError;

const MAX_PATCH_BYTES: usize = 512 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct FileDiffView {
    pub path: String,
    pub status: String,
    pub binary: bool,
    pub patch: String,
    pub truncated: bool,
}

pub(super) async fn bounded(
    git: &GitPort,
    checkout: &Path,
    path: &str,
    previous_path: Option<&str>,
    status: &str,
    binary: bool,
) -> Result<FileDiffView, WorktreeChangesError> {
    let arguments: Vec<&str> = if status == "untracked" {
        vec![
            "diff",
            "--no-index",
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--",
            "/dev/null",
            path,
        ]
    } else if let Some(previous_path) = previous_path {
        vec![
            "diff",
            "HEAD",
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--",
            previous_path,
            path,
        ]
    } else {
        vec![
            "diff",
            "HEAD",
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--",
            path,
        ]
    };
    let outcome = git
        .run_with(
            &arguments,
            checkout,
            RunOptions {
                max_output_bytes: MAX_PATCH_BYTES,
                ..RunOptions::default()
            },
        )
        .await?;
    if !outcome.succeeded && !(status == "untracked" && outcome.stdout.contains("diff --git")) {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not read this file's patch.",
        ));
    }
    let truncated = outcome.stdout_truncated;
    let mut patch = outcome.stdout.as_str();
    if truncated {
        if let Some(last_line) = patch.rfind('\n') {
            patch = &patch[..=last_line];
        } else {
            patch = "";
        }
    }
    Ok(FileDiffView {
        path: path.to_owned(),
        status: status.to_owned(),
        binary,
        patch: patch.to_owned(),
        truncated,
    })
}
