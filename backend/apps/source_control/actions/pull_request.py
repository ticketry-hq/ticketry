"""Opening the pull request, through the user's own ``gh`` login (#984).

This is the provider step, and it is deliberately the thinnest thing that could
work: resolve the base branch, generate a title and body, hand them to ``gh pr
create`` with the body in a file, and report the URL. There is no GitHub client
here, no API version to track, and — the point of the whole design — no
credential. ``gh`` holds the login the user made and can revoke; Ticketry holds
nothing (:mod:`apps.source_control.clients.gh_cli`).

Two preconditions are checked before the caller writes anything, alongside the
push's own (:func:`preflight`): the checkout must not be on the repository's
default branch, because a pull request needs two branches and this surface will
not invent one; and ``gh`` must be present and logged in, because discovering
that *after* a commit and a push would leave the user with the action half done
and nothing to show for it.

The body is passed as a file rather than an argument. A pull request
description is multi-line Markdown, and putting it through an argv slot means
its length competes with the operating system's argument limit; a file has
neither problem and is deleted the moment ``gh`` returns.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from typing import Optional

from apps.source_control.actions.action_steps import (
    STATUS_FAILED,
    STATUS_OK,
    STATUS_SKIPPED,
    STEP_PULL_REQUEST,
    ActionStep,
)
from apps.source_control.changes.change_status import collect_changes
from apps.source_control.checkouts.default_branch import (
    base_branch_for_pull_request,
    default_branch,
)
from apps.source_control.clients.gh_cli import run_gh
from apps.source_control.errors import (
    DefaultBranchCannotOpenPullRequest,
    DirtyTreeCannotOpenPullRequest,
    ProviderNotAuthenticated,
)
from apps.source_control.messages.pull_request_message import (
    PullRequestText,
    generate_pull_request_text,
    read_branch_summary,
)

#: Wall-clock budget for the login check. It is a local read of ``gh``'s own
#: configuration in the common case, so it does not need the create budget.
AUTH_TIMEOUT_SECONDS = 30.0

#: A pull request URL as GitHub writes it, on any host ``gh`` is configured
#: for. Matched against ``gh``'s output rather than assembled from parts, so
#: an enterprise host or a renamed repository still yields the real URL.
_URL_PATTERN = re.compile(r"https?://[^\s'\"<>()]+/pull/\d+")

#: How ``gh`` says a pull request for this branch is already open. It prints the
#: existing URL alongside, which is why this is a skip with a result rather
#: than a failure.
_ALREADY_EXISTS_MARKERS = (
    "already exists",
    "already a pull request",
)


@dataclass(frozen=True)
class PullRequestTarget:
    """A checkout that passed every precondition a pull request has.

    Its existence is the proof, the same way :class:`~apps.source_control.actions.push.Pushable`
    is: a caller cannot reach :func:`create` without having gone through
    :func:`preflight`, so the command is never built from a head branch that is
    also the base or against a ``gh`` that cannot answer.
    """

    branch: str
    base_branch: str
    remote: str


@dataclass(frozen=True)
class PullRequestOutcome:
    """What the pull request step did, and the URL to send the user to.

    ``url`` is the whole point of the action: a pull request the user cannot
    reach is indistinguishable from one that was never opened.

    A refusal is reported here as a *failed step* rather than raised, for the
    same reason a rejected push is: by the time this step runs, a commit has
    landed and a branch has been published, and collapsing the action into an
    error envelope would throw away the record of both. No provider output
    rides along — GitHub's refusals name the remote host, echo whatever the API
    chose to say, and can quote a login held in an environment variable — so
    the step carries a curated sentence and the bytes stay on this machine.
    """

    step: ActionStep
    base_branch: str
    url: Optional[str] = None
    title: Optional[str] = None
    #: A generator name, or ``"template"``. ``None`` when nothing was written.
    text_source: Optional[str] = None
    #: True when the branch already had an open pull request and this action
    #: reported that one instead of opening a second.
    existing: bool = False
    #: True when GitHub refused. ``url`` is then ``None``.
    refused: bool = False


def preflight(
    repo_path: str, *, branch: str, remote: str, recorded_base: str
) -> PullRequestTarget:
    """Everything that must be true before a pull request is worth attempting.

    Raises rather than returns, and runs before the caller commits: each of
    these is a state no pull request could be created from, and none of them is
    something this surface may fix on the user's behalf.
    """

    if branch == default_branch(repo_path, remote=remote):
        raise DefaultBranchCannotOpenPullRequest(branch=branch)
    require_authenticated(repo_path)
    return PullRequestTarget(
        branch=branch,
        base_branch=base_branch_for_pull_request(
            repo_path, remote=remote, recorded_base=recorded_base
        ),
        remote=remote,
    )


def require_authenticated(repo_path: str) -> None:
    """Refuse early when ``gh`` is absent or not logged in.

    ``gh auth status`` is asked rather than the create failure being parsed,
    because "you are not logged in" and "GitHub rejected this pull request" are
    different problems with different fixes, and prose from a CLI is a poor
    place to tell them apart. Its output is never returned — a login status
    line can quote a token — only its exit code is read.
    """

    completion = run_gh(
        ["auth", "status"],
        cwd=repo_path,
        operation="the GitHub login status",
        timeout_seconds=AUTH_TIMEOUT_SECONDS,
    )
    if completion.exit_code != 0:
        raise ProviderNotAuthenticated()


def require_clean_tree(repo_path: str) -> None:
    """Refuse a pull request asked for on its own while changes are uncommitted.

    Unreachable from the stacked action, which commits first. It exists for the
    pull-request-only action, where the branch is what GitHub will review and
    an uncommitted change is work that review would silently omit.
    """

    changes = collect_changes(repo_path)
    if changes.dirty:
        raise DirtyTreeCannotOpenPullRequest(file_count=len(changes.files))


def create(repo_path: str, target: PullRequestTarget) -> PullRequestOutcome:
    """Open the pull request, or report the one that was already open.

    Three outcomes, all of them typed: a pull request is created and its URL
    returned; the branch already had one and that URL is returned as an
    explicit skip; or GitHub refused, and the step fails with a curated
    sentence because the provider's own words are not this app's to repeat.
    """

    text = generate_pull_request_text(
        repo_path=repo_path,
        summary=read_branch_summary(
            repo_path,
            branch=target.branch,
            base_branch=target.base_branch,
            remote=target.remote,
        ),
    )
    completion = _run_create(repo_path, target, text)
    combined = f"{completion.stdout}\n{completion.stderr}"

    if completion.exit_code == 0:
        url = _url_in(combined) or _existing_url(repo_path, target)
        return _opened(target, text, url)
    if _reads_as_already_open(combined):
        url = _url_in(combined) or _existing_url(repo_path, target)
        return _already_open(target, text, url)
    return _refused(target, text)


def _run_create(repo_path: str, target: PullRequestTarget, text: PullRequestText):
    """``gh pr create`` with the body in a temporary file, always deleted."""

    handle, body_path = tempfile.mkstemp(prefix="ticketry-pr-body-", suffix=".md")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as body_file:
            body_file.write(text.body)
        return run_gh(
            [
                "pr",
                "create",
                "--title",
                text.title,
                "--body-file",
                body_path,
                "--base",
                target.base_branch,
                "--head",
                target.branch,
            ],
            cwd=repo_path,
            operation="the new pull request",
        )
    finally:
        # The body is the user's own prose about their own branch, but it has no
        # reason to outlive the call that needed it.
        try:
            os.unlink(body_path)
        except OSError:
            pass


def _existing_url(repo_path: str, target: PullRequestTarget) -> Optional[str]:
    """The URL of whatever pull request this branch already has, if any.

    A last resort for the two cases where ``gh`` did not print one: a create
    that succeeded quietly, and an "already exists" message whose wording
    changed. A failure to look it up is not a failure of the action — the pull
    request exists either way — so this answers ``None`` rather than raising.
    """

    completion = run_gh(
        ["pr", "view", target.branch, "--json", "url"],
        cwd=repo_path,
        operation="the existing pull request",
        timeout_seconds=AUTH_TIMEOUT_SECONDS,
    )
    return _url_in(f"{completion.stdout}\n{completion.stderr}")


def _url_in(text: str) -> Optional[str]:
    """The last pull request URL in ``text``, which is the one ``gh`` reports."""

    found = _URL_PATTERN.findall(text)
    return found[-1] if found else None


def _reads_as_already_open(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _ALREADY_EXISTS_MARKERS)


def _opened(
    target: PullRequestTarget, text: PullRequestText, url: Optional[str]
) -> PullRequestOutcome:
    return PullRequestOutcome(
        base_branch=target.base_branch,
        url=url,
        title=text.title,
        text_source=text.source,
        step=ActionStep(
            STEP_PULL_REQUEST,
            STATUS_OK,
            f"Opened a pull request into {target.base_branch} "
            f"({_source_detail(text.source)}).",
        ),
    )


def _already_open(
    target: PullRequestTarget, text: PullRequestText, url: Optional[str]
) -> PullRequestOutcome:
    return PullRequestOutcome(
        base_branch=target.base_branch,
        url=url,
        title=text.title,
        text_source=text.source,
        existing=True,
        step=ActionStep(
            STEP_PULL_REQUEST,
            STATUS_SKIPPED,
            f"{target.branch} already has an open pull request into "
            f"{target.base_branch}.",
        ),
    )


def _refused(
    target: PullRequestTarget, text: PullRequestText
) -> PullRequestOutcome:
    return PullRequestOutcome(
        base_branch=target.base_branch,
        title=text.title,
        text_source=text.source,
        refused=True,
        step=ActionStep(
            STEP_PULL_REQUEST,
            STATUS_FAILED,
            f"GitHub refused to open a pull request from {target.branch} into "
            f"{target.base_branch}. Run `gh pr create` in a terminal to see "
            "what it said.",
        ),
    )


def _source_detail(source: str) -> str:
    if source == "template":
        return "no generator CLI installed, so the title and body are templated"
    return f"title and body generated with {source}"
