"""Which direct children one advancement of an armed root may launch (CODING-464).

Both execution modes share a single eligibility predicate, so serial scheduling
cannot bypass the dependency truth parallel scheduling uses. The modes differ
only in how many eligible children one advancement selects: ``parallel`` takes
every one of them, ``serial`` takes exactly the lowest-ordered child and only
while no earlier launch still holds the frontier.

Selection is pure — the caller supplies the loaded children, the durable launch
facts, the satisfaction predicate, and the serial frontier fact — so the policy
stays readable and independent of database access.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from apps.execution.execution_mode import SERIAL


def eligible_children(
    children: Sequence[Any],
    *,
    launched_task_ids: set,
    satisfied: Callable[[Any], bool],
) -> list[Any]:
    """Return the children that may be launched, preserving ``children`` order.

    A child is eligible when its own work is unsatisfied, this root recorded no
    launch fact for it, and every blocker it declares is satisfied. Blockers
    outside the subtree stay authoritative because the caller reads them from
    the child's own ``blocked_by`` edges.
    """

    return [
        child
        for child in children
        if not satisfied(child)
        and child.id not in launched_task_ids
        and all(satisfied(blocker) for blocker in child.blocked_by.all())
    ]


def launch_candidates(
    children: Sequence[Any],
    *,
    execution_mode: str,
    launched_task_ids: set,
    satisfied: Callable[[Any], bool],
    serial_frontier_pending: bool,
) -> list[Any]:
    """Choose the children this advancement should launch, in launch order.

    ``children`` must already be ordered by ascending WorkTracker sequence
    number and then opaque task id: that ordering *is* the serial rule, and the
    ticket number is read from the stored sequence rather than parsed from a
    display key. A serial campaign whose frontier is still pending — a live
    launch, or one that ended while its child remains unsatisfied — selects
    nothing and waits for satisfaction or an explicit revival.
    """

    eligible = eligible_children(
        children,
        launched_task_ids=launched_task_ids,
        satisfied=satisfied,
    )
    if execution_mode != SERIAL:
        return eligible
    if serial_frontier_pending:
        return []
    return eligible[:1]
