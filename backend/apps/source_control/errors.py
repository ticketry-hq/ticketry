"""Curated source-control failures.

Raw ``git`` output never crosses the wire (T3 audit, hygiene item 8). Every
failure here carries a sentence a user can act on plus the *lengths* of the
command's streams, so a support conversation can still tell "silent failure"
from "git wrote a page of complaints" without leaking repository content.
"""

from __future__ import annotations

from apps.errors import ApplicationError


class GitUnavailable(ApplicationError):
    """The ``git`` binary is not installed or not on PATH."""

    def __init__(self):
        super().__init__(
            503,
            "Git is not available on this machine.",
            code="git_unavailable",
        )


class GitTimedOut(ApplicationError):
    """A git command exceeded this app's wall-clock budget."""

    def __init__(self, *, operation: str, timeout_seconds: float):
        super().__init__(
            504,
            f"Reading {operation} from this checkout took longer than "
            f"{timeout_seconds:g}s and was stopped.",
            code="git_timeout",
            metadata={"operation": operation, "timeout_seconds": timeout_seconds},
        )


class GitFailed(ApplicationError):
    """A git command exited non-zero. Its output stays on this machine."""

    def __init__(self, *, operation: str, exit_code: int, stderr_bytes: int):
        super().__init__(
            502,
            f"Git could not read {operation} from this checkout.",
            code="git_failed",
            metadata={
                "operation": operation,
                "exit_code": exit_code,
                "stderr_bytes": stderr_bytes,
            },
        )


class ChangesTooLarge(ApplicationError):
    """The change set is past the output cap, so no list can be trusted."""

    def __init__(self, *, output_limit_bytes: int):
        super().__init__(
            413,
            "This checkout has more changes than Studio can list. Review it in "
            "a terminal.",
            code="changes_too_large",
            metadata={"output_limit_bytes": output_limit_bytes},
        )


class FileNotChanged(ApplicationError):
    """A diff was asked for a path this checkout is not currently changing."""

    def __init__(self):
        super().__init__(
            404,
            "That file has no working-tree change in this checkout.",
            code="file_not_changed",
        )


class NoCheckoutToCommit(ApplicationError):
    """A commit was asked of a task with no readable worktree.

    Absence is data for a *read* — the Changes tab explains itself. A write has
    nothing to explain: there is no working tree to commit from.
    """

    def __init__(self, *, reason: str):
        super().__init__(
            409,
            f"There is nothing to commit — {reason}.",
            code="no_checkout",
            metadata={"reason": reason},
        )


class CommitRefused(ApplicationError):
    """``git commit`` exited non-zero, most often because a hook said no.

    The one deliberate exception to "no raw output crosses the wire": hooks are
    repository policy, and their complaint is the only thing that tells the
    user what to fix. The output is capped, and it is the *committing user's
    own* repository speaking, not another tenant's.
    """

    def __init__(self, *, exit_code: int, output: str):
        super().__init__(
            409,
            "Git refused this commit. Repository hooks always run; their "
            "output is below.",
            code="commit_refused",
            metadata={"exit_code": exit_code, "hook_output": output},
        )


class ShipRecordPersistenceFailed(ApplicationError):
    """The Git action settled, but its durable receipt could not be saved."""

    def __init__(self, *, action_result: dict):
        super().__init__(
            500,
            "The source-control action finished, but Ticketry could not save its ship record.",
            code="ship_record_persistence_failed",
            body={
                "detail": "The source-control action finished, but Ticketry could not save its ship record.",
                "code": "ship_record_persistence_failed",
                "action_result": action_result,
            },
        )


class DetachedHeadCannotPush(ApplicationError):
    """A push was asked of a checkout that is not on a branch.

    A precondition, checked before anything is written: there is no branch
    name to build a refspec from, and guessing one would be the surface
    inventing a destination the user never chose.
    """

    def __init__(self):
        super().__init__(
            409,
            "This checkout is on a detached HEAD, so there is no branch to "
            "push. Check out a branch in a terminal first.",
            code="push_detached_head",
        )


class UnbornBranchCannotPush(ApplicationError):
    """A push was asked of a branch that has no commit yet."""

    def __init__(self, *, branch: str):
        super().__init__(
            409,
            f"Branch {branch} has no commits yet, so there is nothing to push.",
            code="push_unborn_branch",
            metadata={"branch": branch},
        )


class NoRemoteToPush(ApplicationError):
    """A push was asked of a checkout with no remote to push to."""

    def __init__(self, *, branch: str):
        super().__init__(
            409,
            f"Branch {branch} has no remote to push to. Add one in a terminal first.",
            code="push_no_remote",
            metadata={"branch": branch},
        )


class ProviderUnavailable(ApplicationError):
    """The ``gh`` CLI is not installed, so no pull request can be created.

    This is not a missing credential — it is a missing *tool*. Ticketry has no
    fallback here on purpose: the alternative to ``gh`` is holding a GitHub
    token, and the whole provider design exists so that it never does.
    """

    def __init__(self):
        super().__init__(
            503,
            "The GitHub CLI (gh) is not available on this machine. Install it "
            "and run `gh auth login`, then try again.",
            code="provider_unavailable",
        )


class ProviderNotAuthenticated(ApplicationError):
    """``gh`` is installed but not logged in to GitHub.

    Resolved by the user in a terminal, with their own credentials, in the
    credential store ``gh`` owns. There is nothing Ticketry could store that
    would fix this, and nothing it offers to.
    """

    def __init__(self):
        super().__init__(
            409,
            "The GitHub CLI is not logged in. Run `gh auth login` in a "
            "terminal, then try again.",
            code="provider_not_authenticated",
        )


class ProviderTimedOut(ApplicationError):
    """A ``gh`` call exceeded this app's wall-clock budget."""

    def __init__(self, *, operation: str, timeout_seconds: float):
        super().__init__(
            504,
            f"GitHub did not answer {operation} within {timeout_seconds:g}s "
            "and the attempt was stopped.",
            code="provider_timeout",
            metadata={"operation": operation, "timeout_seconds": timeout_seconds},
        )


class PullRequestUrlUnsupported(ApplicationError):
    """A stored URL cannot be sent through Ticketry's GitHub boundary."""

    def __init__(self):
        super().__init__(
            422,
            "This ship record does not have a supported GitHub pull request URL.",
            code="pull_request_url_unsupported",
        )


class PullRequestNotFound(ApplicationError):
    """GitHub cannot find the pull request named by the stored URL."""

    def __init__(self):
        super().__init__(
            404,
            "GitHub could not find this pull request.",
            code="pull_request_not_found",
        )


class ProviderResponseMalformed(ApplicationError):
    """GitHub answered, but not with the bounded state contract requested."""

    def __init__(self):
        super().__init__(
            502,
            "GitHub returned an unreadable pull request state.",
            code="provider_response_malformed",
        )


class ProviderLookupFailed(ApplicationError):
    """GitHub refused a state lookup for a reason safe output cannot identify."""

    def __init__(self):
        super().__init__(
            502,
            "GitHub could not refresh this pull request state.",
            code="provider_lookup_failed",
        )


class DefaultBranchCannotOpenPullRequest(ApplicationError):
    """A pull request was asked for from the repository's default branch.

    A pull request needs two different branches. Branching on the user's behalf
    would be this surface inventing a branch name and moving their HEAD, which
    it never does.
    """

    def __init__(self, *, branch: str):
        super().__init__(
            409,
            f"{branch} is this repository's default branch, so there is "
            "nothing to open a pull request against. Check out a feature "
            "branch in a terminal first.",
            code="pull_request_default_branch",
            metadata={"branch": branch},
        )


class DirtyTreeCannotOpenPullRequest(ApplicationError):
    """A pull request was asked for on its own while changes were uncommitted.

    The stacked action does not hit this: it commits first, so by the time the
    pull request runs the tree is clean. Asking for the pull request *alone*
    with a dirty tree would open a review of work the branch does not contain,
    which is worse than refusing.
    """

    def __init__(self, *, file_count: int):
        noun = "change" if file_count == 1 else "changes"
        super().__init__(
            409,
            f"This checkout has {file_count} uncommitted {noun}. Commit them "
            "first — a pull request opened now would not contain them.",
            code="pull_request_dirty_tree",
            metadata={"file_count": file_count},
        )
