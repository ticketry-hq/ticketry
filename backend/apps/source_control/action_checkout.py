"""Resolving the checkout a write action runs in (#982-#985).

Every mutation on this surface starts the same way: turn identifiers into a
resolved checkout, or refuse because there is nothing to write to. Reads can
answer absence with data — a tab that explains itself — but a write cannot, so
absence becomes :class:`~apps.source_control.errors.NoCheckoutToCommit` here
and nowhere else.

The two kinds keep separate entry points rather than sharing one with a mode
flag, so which checkout a mutation touches is fixed by the function that ran.
"""

from __future__ import annotations

from apps.source_control.checkout import (
    ModuleCheckout,
    NoCheckout,
    TaskCheckout,
    resolve_module_checkout,
    resolve_task_checkout,
)
from apps.source_control.errors import NoCheckoutToCommit
from worktracker.models import Issue


def task_checkout_for_action(
    task_id: str,
    parent_id: str | None = None,
    module_id: str | None = None,
) -> TaskCheckout:
    """The task's worktree, or a refusal naming why there is none."""

    try:
        task = Issue.objects.select_related("module", "parent").get(pk=task_id)
    except (Issue.DoesNotExist, ValueError):
        raise NoCheckoutToCommit(reason="this task does not exist") from None
    module = task.module
    if task.type != "task" or module is None:
        raise NoCheckoutToCommit(reason="this work item is not a task")
    if task.parent_id == module.id:
        resolved_parent_id = module.id
    else:
        anchor = task.parent
        if (
            anchor is None
            or anchor.type != "task"
            or anchor.module_id != module.id
            or anchor.parent_id != module.id
        ):
            raise NoCheckoutToCommit(
                reason="this task has no top-level worktree anchor"
            )
        resolved_parent_id = anchor.id

    return _resolved(
        resolve_task_checkout(
            str(task.id),
            parent_id=str(resolved_parent_id),
            module_id=str(module.id),
        )
    )


def module_checkout_for_action(module_id: str) -> ModuleCheckout:
    """The module's base checkout, or a refusal naming why there is none.

    The folder comes from the host's module link — the same binding a module
    shell runs in — so a write can only ever reach a directory the user linked.
    """

    return _resolved(resolve_module_checkout(module_id))


def _resolved(resolved):
    if isinstance(resolved, NoCheckout):
        raise NoCheckoutToCommit(reason=resolved.reason)
    return resolved
