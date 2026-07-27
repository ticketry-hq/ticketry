"""Auto-integrate on Done — the worktrees close hook (Worktrees W3, #589).

The replacement for the old "Land it" button. There is no UI for integrate;
it is a backend side-effect of a task entering the ``completed`` state group.

A ``post_save`` receiver on the worktracker :class:`~worktracker.models.Issue`
fires for every issue save. When the saved issue has entered the ``completed``
group **and** a worktree record is keyed by that issue id (only top-level
tasks own one), it runs :func:`worktrees.service.integrate` off the request
thread so a git merge never blocks the close response.

Design notes:

- Only top-level tasks have worktrees (keyed by their own id), so the natural
  guard is ``dao.get_by_task(str(issue.id))`` — completing a *sub-task* finds
  no record and is a clean no-op.
- ``integrate`` is re-entrant: a clean land deletes the row (later completed
  saves no-op); a conflict leaves a ``conflict`` row intact, so re-marking the
  task Done after a hand resolution retries the land.
- ``cancelled`` is terminal but deliberately does **not** integrate or discard
  — a cancelled task's worktree is left for manual discard.
- Best-effort: every failure is logged and swallowed so the close/save never
  breaks.
"""

from __future__ import annotations

import logging
import threading

from django.db import close_old_connections
from django.db.models.signals import post_save
from django.dispatch import receiver

from worktracker.models import Issue

from apps.worktrees import dao, service


logger = logging.getLogger(__name__)


def _default_executor(fn) -> None:
    """Run ``fn`` on a daemon thread, off the request thread."""

    threading.Thread(target=fn, daemon=True).start()


# Indirection seam so tests can run the integrate synchronously.
integrate_executor = _default_executor


def _safe_integrate(task_id: str) -> None:
    """Integrate best-effort; never raise, and release the thread connection."""

    try:
        service.integrate(task_id)
    except Exception:
        logger.exception("worktree auto-integrate failed task=%s", task_id)
    finally:
        close_old_connections()


@receiver(post_save, sender=Issue, dispatch_uid="worktrees_integrate_on_complete")
def integrate_on_complete(sender, instance, **kwargs) -> None:
    """Land a top-level task's worktree when it enters the completed group."""

    try:
        state = instance.state
        if state is None or state.group != "completed":
            return
        task_id = str(instance.id)
        if dao.get_by_task(task_id) is None:
            # Not a top-level task with a worktree (sub-task / no opt-in).
            return
        integrate_executor(lambda: _safe_integrate(task_id))
    except Exception:
        logger.exception("worktree close hook error issue=%s", getattr(instance, "id", "?"))
