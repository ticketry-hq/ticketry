use crate::entities::worktrees::worktree;

use super::super::PullRequestStatusView;

pub(super) fn build(
    row: &worktree::Model,
    status: &PullRequestStatusView,
    pull_request_url: &str,
) -> String {
    let blocker = match status.state.as_str() {
        "merge_conflict" => "merge conflicts",
        "checks_failed" => "failed required checks",
        _ => "an ineligible pull-request state",
    };
    format!(
        "Prepare the mapped pull request for merge by resolving {blocker}.\n\n\
Pull request: {pull_request_url}\n\
Task worktree branch: {}\n\
Recorded base branch: {}\n\
Current pull-request head: {}\n\n\
The user's click authorizes you to inspect and edit only this existing task worktree, run relevant validation, commit the repair, and push only the task worktree branch named above. Do not merge or approve the pull request. Do not bypass branch protection or repository policy. Do not delete the worktree or any branch. Do not switch, modify, or push any unrelated branch. Stop after the task branch is updated and report what remains.",
        one_line(&row.branch),
        one_line(&row.base_branch),
        status.head_commit.as_deref().map(one_line).unwrap_or("unknown"),
    )
}

fn one_line(value: &str) -> &str {
    value.split(['\r', '\n']).next().unwrap_or_default().trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> worktree::Model {
        worktree::Model {
            id: "worktree".into(),
            task_id: "task".into(),
            workspace_slug: None,
            project_id: None,
            module_id: None,
            ticket_seq: None,
            repo_root: "/repo".into(),
            path: "/repo/worktree".into(),
            branch: "wt/CODING-1327".into(),
            base_branch: "main".into(),
            base_commit: "base".into(),
            status: "active".into(),
            ephemeral: false,
            created_at: "now".into(),
            updated_at: "now".into(),
            pull_request_url: Some("https://github.com/ticketry/ticketry/pull/1327".into()),
        }
    }

    #[test]
    fn prompt_names_the_pull_request_and_limits_branch_authority() {
        let mut status = PullRequestStatusView::none();
        status.state = "checks_failed".into();
        status.head_commit = Some("abcdef".into());
        let prompt = build(
            &row(),
            &status,
            "https://github.com/ticketry/ticketry/pull/1327",
        );

        for required in [
            "failed required checks",
            "https://github.com/ticketry/ticketry/pull/1327",
            "wt/CODING-1327",
            "push only the task worktree branch",
            "Do not merge or approve",
            "Do not bypass branch protection",
            "Do not delete the worktree",
            "Do not switch, modify, or push any unrelated branch",
        ] {
            assert!(prompt.contains(required), "missing prompt rule: {required}");
        }
    }
}
