"""Publishing the current branch, and refusing to do anything cleverer.

This is the whole outbound surface. It sends one branch to one remote with an
explicit refspec and no leading ``+``, so the command it builds is incapable
of rewriting remote history — there is no code path here that could add
``--force``, and ``--no-force`` is passed as well so a repository's own config
cannot supply one. Nothing here merges, rebases, pulls, or fetches: when the
remote holds work the local branch does not, the push *fails* and says so,
because reconciling two histories is a decision the user makes in a terminal
with the diff in front of them, not something a review surface guesses at.

Preconditions are checked before the caller writes anything (:func:`preflight`)
so an action that cannot possibly publish never commits first and discovers it
afterwards. Divergence is the exception, and deliberately so: it is a fact
about the *remote*, a local commit is still worth keeping, and blocking the
commit would throw away good work over a condition the user resolves later.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.source_control.action_steps import (
    STATUS_FAILED,
    STATUS_OK,
    STATUS_SKIPPED,
    STEP_PUSH,
    ActionStep,
)
from apps.source_control.errors import (
    DetachedHeadCannotPush,
    NoRemoteToPush,
    UnbornBranchCannotPush,
)
from apps.source_control.git_cli import run_git_capturing
from apps.source_control.remote_branch import (
    BranchPosition,
    current_branch,
    head_sha,
    read_position,
    resolve_remote,
)

#: Wall-clock budget for the push itself. Generous because a pre-push hook is
#: repository policy and may lint or test, and because the transfer is a
#: network operation; bounded because neither may hold a request forever.
PUSH_TIMEOUT_SECONDS = 300.0

#: How much of a push's own output this app will buffer. It is never returned
#: (see the module docstring on :class:`PushOutcome`), only measured.
PUSH_OUTPUT_LIMIT_BYTES = 32 * 1024

#: Why a push did not publish anything. These reach the client as codes so the
#: wording can change without a client re-reading prose.
FAILED_DIVERGED = "diverged"
FAILED_REJECTED = "rejected"

#: Anything git says when it refuses a non-fast-forward update. Matched against
#: git's own porcelain and stderr, both of which are stable under ``LC_ALL=C``.
_DIVERGENCE_MARKERS = (
    "non-fast-forward",
    "fetch first",
    "[rejected]",
    "behind its remote",
)


#: Why a checkout cannot publish anything at all. Each is a state the user
#: resolves in a terminal, never something this surface changes for them.
BLOCKED_DETACHED_HEAD = "detached_head"
BLOCKED_UNBORN_BRANCH = "unborn_branch"
BLOCKED_NO_REMOTE = "no_remote"


@dataclass(frozen=True)
class NotPushable:
    """A checkout no push could succeed from, and which of the reasons it is."""

    code: str
    branch: str


@dataclass(frozen=True)
class Pushable:
    """A checkout that passed every precondition a push has.

    Its existence is the proof: a caller cannot reach :func:`push_branch`
    without having gone through :func:`preflight`, so the push command is
    never built from a branch name that might be empty or a remote that might
    not exist.
    """

    branch: str
    remote: str
    head_sha: str
    base_branch: str


@dataclass(frozen=True)
class PushOutcome:
    """What the push step did.

    A failure is reported as a step rather than raised, because by the time
    the push runs the commit before it has already landed: collapsing the
    action into an error envelope here would throw away the sha the caller
    needs in order to tell the user what *did* happen.

    No git output rides along. A rejected push's own words name remote URLs
    and echo whatever the server chose to say, and this app's rule is that raw
    command output stays on this machine; the curated ``detail`` plus a code is
    what a client acts on. (The commit step's hook output is the one carved-out
    exception, and it is not widened here.)
    """

    step: ActionStep
    remote: str
    branch: str
    pushed_sha: str | None = None
    failure_code: str | None = None
    commit_shas: tuple[str, ...] = ()

    @property
    def published(self) -> bool:
        return self.pushed_sha is not None


def inspect(repo_path: str, *, base_branch: str = "") -> Pushable | NotPushable:
    """Whether this checkout could publish anything, without deciding for you.

    Returns rather than raises, because the same three conditions have to be
    two different things: an *explanation* when a confirmation step is asking
    whether the action can run, and a refusal when the action is running. This
    is the single reading; :func:`preflight` is the refusing spelling of it.
    """

    branch = current_branch(repo_path)
    if branch is None:
        return NotPushable(code=BLOCKED_DETACHED_HEAD, branch="")
    head = head_sha(repo_path)
    if head is None:
        return NotPushable(code=BLOCKED_UNBORN_BRANCH, branch=branch)
    remote = resolve_remote(repo_path, branch)
    if remote is None:
        return NotPushable(code=BLOCKED_NO_REMOTE, branch=branch)
    return Pushable(
        branch=branch, remote=remote, head_sha=head, base_branch=base_branch
    )


def preflight(repo_path: str, *, base_branch: str = "") -> Pushable:
    """Everything that must be true before a push is worth attempting.

    Raises rather than returns, and runs before the caller writes anything:
    each of these is a state no push could succeed from, and none of them is
    something this surface may fix on the user's behalf.
    """

    inspected = inspect(repo_path, base_branch=base_branch)
    if isinstance(inspected, Pushable):
        return inspected
    raise _BLOCKED_ERRORS[inspected.code](inspected.branch)


#: Each blocking reason's refusal, keyed so :func:`preflight` cannot answer
#: one condition with another's sentence.
_BLOCKED_ERRORS = {
    BLOCKED_DETACHED_HEAD: lambda branch: DetachedHeadCannotPush(),
    BLOCKED_UNBORN_BRANCH: lambda branch: UnbornBranchCannotPush(branch=branch),
    BLOCKED_NO_REMOTE: lambda branch: NoRemoteToPush(branch=branch),
}


def push_branch(repo_path: str, pushable: Pushable) -> PushOutcome:
    """Publish ``pushable``'s branch, or report why nothing was published.

    Three outcomes, all of them typed: the remote already has this commit and
    the push is skipped; the remote holds work this branch does not and the
    push fails with the one instruction that can resolve it; or the branch is
    published and the step reports the sha that is now on the remote.
    """

    head = _current_head(repo_path, pushable)
    standing = read_position(
        repo_path,
        branch=pushable.branch,
        remote=pushable.remote,
        head=head,
        base_branch=pushable.base_branch,
    )
    if standing.up_to_date:
        return _skipped(pushable)
    if not standing.fast_forward:
        return _diverged(pushable, standing)

    completion = run_git_capturing(
        # The refspec is explicit, fully qualified, and carries no ``+``; a
        # push built here can only ever fast-forward one branch.
        [
            "push",
            "--no-force",
            "--porcelain",
            pushable.remote,
            f"refs/heads/{pushable.branch}:refs/heads/{pushable.branch}",
        ],
        cwd=repo_path,
        operation=f"the push of {pushable.branch} to {pushable.remote}",
        timeout_seconds=PUSH_TIMEOUT_SECONDS,
        output_limit_bytes=PUSH_OUTPUT_LIMIT_BYTES,
    )
    if completion.exit_code != 0:
        # A push can still be refused after a clean probe: someone else may
        # have pushed in between. The verdict is the same either way.
        if _reads_as_divergence(completion.stdout, completion.stderr):
            return _diverged(pushable, standing)
        return _rejected(pushable, standing)
    return _published(pushable, standing, head)


def _current_head(repo_path: str, pushable: Pushable) -> str:
    """HEAD as it stands now, which a commit since the preflight will have moved."""

    return head_sha(repo_path) or pushable.head_sha


def _reads_as_divergence(stdout: str, stderr: str) -> bool:
    combined = f"{stdout}\n{stderr}".lower()
    return any(marker in combined for marker in _DIVERGENCE_MARKERS)


def _skipped(pushable: Pushable) -> PushOutcome:
    return PushOutcome(
        remote=pushable.remote,
        branch=pushable.branch,
        step=ActionStep(
            STEP_PUSH,
            STATUS_SKIPPED,
            f"{pushable.remote}/{pushable.branch} already has this commit.",
        ),
    )


def _diverged(pushable: Pushable, standing: BranchPosition) -> PushOutcome:
    return PushOutcome(
        remote=pushable.remote,
        branch=pushable.branch,
        failure_code=FAILED_DIVERGED,
        commit_shas=standing.commit_shas,
        step=ActionStep(
            STEP_PUSH,
            STATUS_FAILED,
            f"{pushable.remote}/{pushable.branch} has commits this branch "
            "does not. Ticketry never merges or rebases for you — resolve it "
            "in a terminal, then push again.",
        ),
    )


def _rejected(pushable: Pushable, standing: BranchPosition) -> PushOutcome:
    return PushOutcome(
        remote=pushable.remote,
        branch=pushable.branch,
        failure_code=FAILED_REJECTED,
        commit_shas=standing.commit_shas,
        step=ActionStep(
            STEP_PUSH,
            STATUS_FAILED,
            f"Git could not push {pushable.branch} to {pushable.remote}. Run "
            "the push in a terminal to see what the remote said.",
        ),
    )


def _published(pushable: Pushable, standing: BranchPosition, head: str) -> PushOutcome:
    published = "Published" if standing.remote_sha is None else "Pushed"
    noun = "commit" if standing.commit_count == 1 else "commits"
    return PushOutcome(
        remote=pushable.remote,
        branch=pushable.branch,
        pushed_sha=head,
        commit_shas=standing.commit_shas,
        step=ActionStep(
            STEP_PUSH,
            STATUS_OK,
            f"{published} {standing.commit_count} {noun} to "
            f"{pushable.remote}/{pushable.branch}.",
        ),
    )
