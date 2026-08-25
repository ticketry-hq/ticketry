"""Committing everything a checkout changed (#982, #985).

One mutation, run under this app's per-checkout lock: reset the index, add
every working-tree change, generate a subject, and commit with the
repository's hooks enabled. There is no staging interface — the index is a
means here, reset on the way in so a commit can never inherit whatever a
terminal left half-staged, and never presented as state a user curates. The
change set is not curated either: the surface commits all of it, because
curation happens upstream by having an agent fix the tree (CODING-961 HLD).

The result is ordered typed progress rather than a bare success flag: each of
the three steps reports ``ok``, ``skipped``, or ``failed``, so a caller can
show what happened and a clean tree reads as an explicit skip instead of a
silent no-op.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

from apps.source_control.actions import checkout_lock
from apps.source_control.actions.action_checkout import (
    module_checkout_for_action,
    task_checkout_for_action,
)
from apps.source_control.actions.action_steps import (
    STATUS_OK,
    STATUS_SKIPPED,
    STEP_COMMIT,
    STEP_MESSAGE,
    STEP_STAGE,
    ActionStep,
)
from apps.source_control.changes.change_status import ChangedFile, collect_changes
from apps.source_control.checkouts.checkout import Checkout
from apps.source_control.clients.git_cli import run_git, run_git_capturing
from apps.source_control.errors import CommitRefused, GitFailed
from apps.source_control.messages.commit_message import (
    PATCH_PROMPT_LIMIT_CHARS,
    GeneratedMessage,
    generate_commit_subject,
)
from apps.source_control.records.ship_records import (
    failed_action,
    new_action_id,
    persist_ship_record_or_fail,
)

if TYPE_CHECKING:
    from apps.source_control.models import ShipRecord


#: Wall-clock budget for ``git commit`` itself. Generous because hooks are
#: repository policy and may lint or build; bounded because a wedged hook must
#: not hold a request forever.
COMMIT_TIMEOUT_SECONDS = 300.0

#: How much of a rejected commit's output is returned. Hook complaints are the
#: point of the failure; a hook that writes a build log is still capped.
HOOK_OUTPUT_LIMIT_BYTES = 32 * 1024

COMMITTED = "committed"
NOTHING_TO_COMMIT = "nothing_to_commit"


@dataclass(frozen=True)
class CommitOutcome:
    """The whole mutation's result. Discriminated on ``status``."""

    status: str
    steps: tuple[ActionStep, ...]
    branch: str
    commit_sha: str | None = None
    subject: str | None = None
    #: A generator name, or ``"template"``. ``None`` when nothing was committed.
    message_source: str | None = None
    file_count: int = 0
    insertions: int = 0
    deletions: int = 0
    commit_shas: tuple[str, ...] = ()
    action_id: uuid.UUID | None = None
    ship_record: ShipRecord | None = None


def _reset_index(repo_path: str) -> None:
    """Drop whatever was staged before, without touching the working tree."""

    run_git(
        ["reset", "--quiet"],
        cwd=repo_path,
        operation="this checkout's index",
        # A checkout whose branch has no commit yet has no HEAD to reset to,
        # and nothing staged that could have survived from anywhere else.
        allowed_exit_codes=(0, 128),
    )


def _add_all(repo_path: str) -> None:
    """Stage every working-tree change, including untracked and deleted paths."""

    run_git(
        ["add", "--all", "--", "."],
        cwd=repo_path,
        operation="this checkout's changes",
    )


def _staged_patch(repo_path: str) -> str:
    """The staged diff, capped to what a generator is shown."""

    result = run_git(
        ["diff", "--cached", "--no-ext-diff", "--no-textconv"],
        cwd=repo_path,
        operation="this checkout's staged changes",
        output_limit_bytes=PATCH_PROMPT_LIMIT_CHARS,
    )
    return result.stdout


def _has_staged_changes(repo_path: str) -> bool:
    """True when the index differs from HEAD, so a commit would carry content."""

    operation = "this checkout's staged changes"
    result = run_git_capturing(
        ["diff", "--cached", "--quiet"],
        cwd=repo_path,
        operation=operation,
        # A path list is not needed to answer yes or no.
        output_limit_bytes=4096,
    )
    # 1 is this command's way of saying "yes, there are differences". Any
    # other non-zero exit is a real failure and must not read as a yes.
    if result.exit_code not in (0, 1):
        raise GitFailed(
            operation=operation,
            exit_code=result.exit_code,
            stderr_bytes=len(result.stderr.encode("utf-8", errors="replace")),
        )
    return result.exit_code == 1


def _run_commit(repo_path: str, subject: str) -> str:
    """Commit the index with hooks enabled; return the new commit's sha."""

    completion = run_git_capturing(
        # No --no-verify, ever: hooks are the repository's policy, not ours.
        ["commit", "--message", subject],
        cwd=repo_path,
        operation="this commit",
        timeout_seconds=COMMIT_TIMEOUT_SECONDS,
        output_limit_bytes=HOOK_OUTPUT_LIMIT_BYTES,
    )
    if completion.exit_code != 0:
        raise CommitRefused(
            exit_code=completion.exit_code,
            output=_combined(completion.stdout, completion.stderr),
        )
    return run_git(
        ["rev-parse", "HEAD"],
        cwd=repo_path,
        operation="the new commit",
        output_limit_bytes=4096,
    ).stdout.strip()


def _combined(stdout: str, stderr: str) -> str:
    """Both streams as the hook wrote them, in the order a terminal shows them."""

    return "\n".join(part for part in (stdout.strip(), stderr.strip()) if part)


def _nothing_to_commit(branch: str) -> CommitOutcome:
    return CommitOutcome(
        status=NOTHING_TO_COMMIT,
        branch=branch,
        steps=(
            ActionStep(
                STEP_STAGE,
                STATUS_SKIPPED,
                "This checkout matches its last commit.",
            ),
            ActionStep(
                STEP_MESSAGE,
                STATUS_SKIPPED,
                "No changes to describe.",
            ),
            ActionStep(
                STEP_COMMIT,
                STATUS_SKIPPED,
                "Nothing to commit.",
            ),
        ),
    )


def commit_all_changes(checkout: Checkout) -> CommitOutcome:
    """Commit every change in ``checkout``, or report that there were none.

    Holds the checkout's write lock for the whole mutation, so two commits on
    one checkout run one after the other while commits on different checkouts
    do not wait on each other at all. The lock is keyed by the checkout's path,
    which is why a task worktree and its module's base checkout — two different
    directories — never block each other either.
    """

    with checkout_lock.serialized(checkout.path):
        return commit_locked_checkout(checkout)


def commit_locked_checkout(checkout: Checkout) -> CommitOutcome:
    """The commit itself, for a caller that already holds the checkout's lock.

    Separate from :func:`commit_all_changes` because a stacked action has to
    hold the lock across *its* whole sequence: a push that read a HEAD some
    other writer had already moved would publish a commit the caller never
    made. The lock boundary therefore belongs to the outermost action, and
    this is the step it composes.
    """

    _reset_index(checkout.path)
    _add_all(checkout.path)
    if not _has_staged_changes(checkout.path):
        return _nothing_to_commit(checkout.branch)

    # Read the change set *after* staging, so what the result reports is what
    # the commit actually carries — not what a stale index claimed.
    changes = collect_changes(checkout.path)
    files: Sequence[ChangedFile] = changes.files
    message: GeneratedMessage = generate_commit_subject(
        repo_path=checkout.path,
        files=files,
        patch=_staged_patch(checkout.path),
    )
    commit_sha = _run_commit(checkout.path, message.subject)

    return CommitOutcome(
        status=COMMITTED,
        branch=checkout.branch,
        commit_sha=commit_sha,
        subject=message.subject,
        message_source=message.source,
        file_count=len(files),
        insertions=changes.insertions,
        deletions=changes.deletions,
        commit_shas=(commit_sha.lower(),),
        steps=(
            ActionStep(
                STEP_STAGE,
                STATUS_OK,
                _staged_detail(len(files)),
            ),
            ActionStep(
                STEP_MESSAGE,
                STATUS_OK,
                _message_detail(message.source),
            ),
            ActionStep(
                STEP_COMMIT,
                STATUS_OK,
                f"Committed {commit_sha[:7]} with hooks.",
            ),
        ),
    )


def _staged_detail(file_count: int) -> str:
    noun = "file" if file_count == 1 else "files"
    return f"Added {file_count} {noun} to a reset index."


def _message_detail(source: str) -> str:
    if source == "template":
        return "No generator CLI installed; used the built-in template."
    return f"Generated with {source}."


def commit_worktree_changes(
    task_id: str,
    parent_id: str | None = None,
    module_id: str | None = None,
    action_id: uuid.UUID | str | None = None,
) -> CommitOutcome:
    """Commit the task worktree's changes, named by task rather than by path.

    The transport-independent entry point: callers identify a task, never a
    filesystem location, so the only directory this mutation can run in is the
    one the worktrees index already recorded for it.
    """

    return _commit_and_record(
        task_checkout_for_action(task_id, parent_id, module_id),
        action_id=action_id,
    )


def commit_module_changes(
    module_id: str, action_id: uuid.UUID | str | None = None
) -> CommitOutcome:
    """Commit the module base checkout's changes, named by module.

    The same mutation as the worktree's, reached by naming a module instead of
    a task. Nothing below this line knows the difference — the commit runs in
    the resolved path either way — which is the point: one commit action, two
    ways of saying which checkout it runs in.
    """

    return _commit_and_record(
        module_checkout_for_action(module_id),
        action_id=action_id,
    )


def _commit_and_record(
    checkout: Checkout,
    *,
    action_id: uuid.UUID | str | None,
) -> CommitOutcome:
    resolved_action_id = new_action_id(action_id)
    with checkout_lock.serialized(checkout.path):
        try:
            outcome = commit_locked_checkout(checkout)
        except Exception:
            terminal = failed_action(checkout, phase=STEP_COMMIT)
            persist_ship_record_or_fail(
                checkout,
                terminal,
                action_id=resolved_action_id,
            )
            raise
    record = persist_ship_record_or_fail(
        checkout,
        outcome,
        action_id=resolved_action_id,
    )
    return replace(
        outcome,
        action_id=resolved_action_id,
        ship_record=record,
    )
