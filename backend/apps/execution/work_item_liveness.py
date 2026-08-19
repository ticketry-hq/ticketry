"""Which work items currently have something running on them (CODING-689).

Liveness here is a fact about the *work item*, never about a campaign's launch
ledger: a work item is live while any agent run recorded against it has not
ended, or any terminal session recorded against it has not terminated —
whichever started it. A manual subtree-run press reads this to decide what it
may start, so an agent the user launched by hand on a child is respected while a
stale launch fact on a sibling costs nothing.

Deliberately separate from the launch ledger and from the serial frontier, both
of which read what *this campaign* started.
"""

from __future__ import annotations

from collections.abc import Iterable

from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession


def live_work_item_ids(
    task_ids: Iterable,
    *,
    exclude_agent_run_id: str | None = None,
) -> set[str]:
    """Return the subset of ``task_ids`` with a live agent run or terminal.

    Ids are compared as strings so callers may pass model keys or their string
    forms; the terminal mirror stores its work item as text while runs store a
    foreign key, and both are answered in one pass per store.

    ``exclude_agent_run_id`` discounts one agent run from the answer — the run
    asking the question. It is dropped both as a run of its own and as the run
    that owns a terminal session, so a caller does not see itself as the thing
    already occupying the work item.
    """

    wanted = {str(task_id) for task_id in task_ids}
    if not wanted:
        return set()

    runs = AgentRun.objects.filter(issue_id__in=wanted, ended_at__isnull=True)
    sessions = AgentTerminalSession.objects.filter(
        task_id__in=wanted,
        terminated_at__isnull=True,
    )
    if exclude_agent_run_id is not None:
        runs = runs.exclude(id=exclude_agent_run_id)
        sessions = sessions.exclude(agent_run_id=exclude_agent_run_id)

    live = {
        str(issue_id) for issue_id in runs.values_list("issue_id", flat=True)
    }
    live.update(
        str(task_id) for task_id in sessions.values_list("task_id", flat=True)
    )
    return live


def has_live_work(
    task_id,
    *,
    exclude_agent_run_id: str | None = None,
) -> bool:
    """Whether one work item is live, by the same rule as ``live_work_item_ids``."""

    return bool(
        live_work_item_ids(
            [task_id],
            exclude_agent_run_id=exclude_agent_run_id,
        )
    )
