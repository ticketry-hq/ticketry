from __future__ import annotations

import logging
import os
from typing import Optional, Union

from apps.worktrees import dao, naming
from apps.worktrees.models import Worktree
from apps.worktrees.service.types import (
    NoWorktree,
    WorktreeStatus,
    IntegrateResult,
    DiscardResult,
    ReconcileResult,
)
from apps.worktrees.service.git import (
    _git,
    discover_repo,
    _known_worktree_paths,
)

logger = logging.getLogger(__name__)


def _remote_tracking_refs(repo_root: str, branch: str) -> list[str]:
    """Local remote-tracking refs whose branch name exactly matches ``branch``.

    Branch names contain slashes, so a suffix match on ``/<branch>`` would also
    hit a *different* branch (``refs/remotes/origin/feature/foo`` for ``foo``).
    Each configured remote gives exactly one candidate ref name; only those are
    considered, and only the ones that actually exist are returned.
    """

    remotes = _git(["remote"], repo_root, check=False)
    if remotes.returncode != 0:
        return []
    candidates = {
        f"refs/remotes/{remote.strip()}/{branch}"
        for remote in remotes.stdout.splitlines()
        if remote.strip()
    }
    if not candidates:
        return []
    listed = _git(
        ["for-each-ref", "--format=%(refname)", "refs/remotes"],
        repo_root,
        check=False,
    )
    if listed.returncode != 0:
        return []
    return [
        ref.strip()
        for ref in listed.stdout.splitlines()
        if ref.strip() in candidates
    ]


def top_level_task_id(
    *,
    task_id: str,
    parent_id: Optional[str],
    module_id: Optional[str],
) -> str:
    """Resolve a task to the top-level task that owns the worktree.

    A top-level task's parent is the module itself, so it owns its worktree.
    A sub-task's parent is another task; it shares that parent's worktree.
    (Sub-tasks are one level deep per the planning model.) W1 ships this for
    W2 to call at launch time; W1 never calls it from a launch path itself.
    """

    if parent_id and parent_id != module_id:
        return parent_id
    return task_id


def create(
    *,
    task_id: str,
    working_path: str,
    task_name: Optional[str] = None,
    ticket_seq: Optional[int] = None,
    ephemeral: bool = False,
    project_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> Union[Worktree, NoWorktree]:
    """Create (or return the existing) worktree for a top-level task.

    Cuts ``wt/CODIN-<seq>-<slug>`` off the discovered repo's current committed
    HEAD and records the base branch + base commit. Idempotent: a live record
    for the task is returned as-is. A path with no enclosing repo yields a
    :class:`NoWorktree` with a reason — never an exception.
    """

    existing = dao.get_by_task(task_id)
    if existing is not None:
        return existing

    repo_root = discover_repo(working_path)
    if repo_root is None:
        return NoWorktree(reason=f"no git repository encloses {working_path!r}")

    base_commit = _git(["rev-parse", "HEAD"], repo_root).stdout.strip()
    head_ref = _git(["symbolic-ref", "--quiet", "--short", "HEAD"], repo_root, check=False)
    # Detached HEAD → record the sha as the integration target.
    base_branch = head_ref.stdout.strip() if head_ref.returncode == 0 else base_commit

    slug_value = naming.slug(task_name)
    branch = naming.branch_name(ticket_seq, slug_value)
    path = naming.worktree_path(repo_root, ticket_seq, slug_value)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Branch off the committed HEAD sha — uncommitted primary changes are
    # intentionally not carried into the isolated worktree.
    _git(["worktree", "add", "-b", branch, path, base_commit], repo_root)

    record = dao.create(
        task_id=task_id,
        repo_root=repo_root,
        path=path,
        branch=branch,
        base_branch=base_branch,
        base_commit=base_commit,
        status="active",
        ephemeral=ephemeral,
        project_id=project_id,
        module_id=module_id,
        ticket_seq=ticket_seq,
    )
    logger.info("worktree created task=%s branch=%s path=%s", task_id, branch, path)
    return record


def status(task_id: str) -> Union[WorktreeStatus, NoWorktree]:
    """Report live clean/dirty + ahead/behind + conflict for a task's worktree."""

    record = dao.get_by_task(task_id)
    if record is None:
        return NoWorktree(reason=f"no worktree for task {task_id!r}")

    path = record.path
    if not os.path.isdir(path):
        return WorktreeStatus(
            task_id=task_id,
            path=path,
            branch=record.branch,
            base_branch=record.base_branch,
            exists=False,
            clean=False,
            dirty=False,
            ahead=0,
            behind=0,
            conflict=record.status == "conflict",
            status=record.status,
        )

    porcelain = _git(["status", "--porcelain"], path).stdout
    dirty = bool(porcelain.strip())

    behind = ahead = 0
    counts = _git(
        ["rev-list", "--left-right", "--count", f"{record.base_branch}...HEAD"],
        path,
        check=False,
    )
    parts = counts.stdout.split()
    if counts.returncode == 0 and len(parts) == 2:
        # left = commits on base not on HEAD (behind); right = the reverse (ahead).
        behind, ahead = int(parts[0]), int(parts[1])

    unmerged = _git(["diff", "--name-only", "--diff-filter=U"], path).stdout.strip()
    conflict = bool(unmerged) or record.status == "conflict"

    return WorktreeStatus(
        task_id=task_id,
        path=path,
        branch=record.branch,
        base_branch=record.base_branch,
        exists=True,
        clean=not dirty,
        dirty=dirty,
        ahead=ahead,
        behind=behind,
        conflict=conflict,
        status="conflict" if conflict else "active",
    )


def list_worktrees(
    *,
    project_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> list[Worktree]:
    """List persisted worktree records, optionally scoped."""

    return dao.list_by_scope(project_id=project_id, module_id=module_id)


def integrate(task_id: str) -> IntegrateResult:
    """Land a task branch back into its recorded base.

    Steps: guard (clean, not ephemeral) → merge base INTO the worktree → on
    conflict mark ``conflict`` and stop with the tree intact → on clean merge
    fast-forward base to the task branch → remove the worktree + delete the
    branch → delete the row. The merge always happens in the isolated tree, so
    the primary checkout is never left in a half-merged state.
    """

    record = dao.get_by_task(task_id)
    if record is None:
        return IntegrateResult(task_id, "no_worktree", "no worktree for task")
    if record.ephemeral:
        return IntegrateResult(task_id, "ephemeral", "ephemeral worktrees are discard-only")

    path = record.path
    repo_root = record.repo_root
    branch = record.branch
    base_branch = record.base_branch

    # Guard: integrate needs commits, not uncommitted edits.
    if _git(["status", "--porcelain"], path).stdout.strip():
        return IntegrateResult(task_id, "dirty", "worktree has uncommitted changes; commit first")

    # Merge the recorded base INTO the worktree (the only mutation, isolated).
    merge = _git(["merge", "--no-edit", base_branch], path, check=False)
    if merge.returncode != 0:
        # Conflict (or other merge failure): leave the tree as-is for resolution.
        unmerged = _git(["diff", "--name-only", "--diff-filter=U"], path).stdout.strip()
        if unmerged:
            dao.set_status(task_id, "conflict")
            logger.info("worktree integrate conflict task=%s", task_id)
            return IntegrateResult(task_id, "conflict", "merge conflict; resolve in the worktree")
        # Non-conflict merge failure — surface it without losing the tree.
        return IntegrateResult(task_id, "conflict", merge.stderr.strip() or "merge failed")

    # Clean merge: the task branch now contains base, so base can fast-forward.
    primary_head = _git(["symbolic-ref", "--quiet", "--short", "HEAD"], repo_root, check=False)
    base_checked_out = (
        primary_head.returncode == 0 and primary_head.stdout.strip() == base_branch
    )
    if base_checked_out:
        # ff-only can never create a merge commit or conflict in the primary.
        _git(["merge", "--ff-only", branch], repo_root)
    else:
        # Base isn't checked out: move its ref straight to the (merged) tip.
        _git(["branch", "-f", base_branch, branch], repo_root)

    # Tree is fully merged: remove the checkout and delete the merged branch.
    _git(["worktree", "remove", path], repo_root)
    # When base is checked out, -d is a real safety check (merged into HEAD).
    # Otherwise HEAD is some other branch, so -d would wrongly refuse — but we
    # just set base == branch tip via branch -f, proving the merge, so -D.
    _git(["branch", "-d" if base_checked_out else "-D", branch], repo_root)
    dao.delete(task_id)
    logger.info("worktree integrated task=%s branch=%s -> %s", task_id, branch, base_branch)
    return IntegrateResult(task_id, "integrated")


def discard(task_id: str) -> DiscardResult:
    """Remove a worktree and every local ref for its branch."""

    record = dao.get_by_task(task_id)
    if record is None:
        return DiscardResult(task_id, removed=False, reason="no worktree for task")

    removed = _git(["worktree", "remove", "--force", record.path], record.repo_root, check=False)
    if removed.returncode != 0:
        # Tree may have been removed out of band; clean up git's admin records.
        _git(["worktree", "prune"], record.repo_root, check=False)
    # -D: dirty / un-merged is expected on discard.
    _git(["branch", "-D", record.branch], record.repo_root, check=False)
    # Drop local knowledge of the published task branch without sending a
    # delete refspec to its provider. Provider-side branch policy stays with
    # the provider.
    for ref in _remote_tracking_refs(record.repo_root, record.branch):
        _git(["update-ref", "-d", ref], record.repo_root, check=False)
    dao.delete(task_id)
    logger.info("worktree discarded task=%s branch=%s", task_id, record.branch)
    return DiscardResult(task_id, removed=True)


def reconcile() -> ReconcileResult:
    """Prune rows whose worktree git no longer knows; keep live ones.

    Best-effort startup cleanup so records re-attach to real trees after a
    restart. Never recreates trees. A row whose ``path`` is absent from its
    repo's ``git worktree list`` (manually removed) is deleted.
    """

    pruned: list[str] = []
    kept = 0
    known_by_repo: dict[str, set[str]] = {}
    for record in dao.list_all():
        repo_root = record.repo_root
        if repo_root not in known_by_repo:
            known_by_repo[repo_root] = _known_worktree_paths(repo_root)
        if os.path.normpath(record.path) in known_by_repo[repo_root]:
            kept += 1
        else:
            dao.delete(record.task_id)
            pruned.append(record.task_id)
    if pruned:
        logger.info("worktree reconcile pruned %d stale rows", len(pruned))
    return ReconcileResult(pruned=pruned, kept=kept)
