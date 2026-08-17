"""Which direct children an advancement of an armed root may launch (CODING-464).

There are two selection policies here, one per trigger, and they differ only in
what makes a child unavailable.

*Automatic* advancement — a lifecycle observation — asks the campaign's own
bookkeeping: a child this root already recorded a launch fact for is never
launched again, and a serial campaign waits behind its frontier.
:func:`launch_candidates` is that policy and is deliberately untouched.

*Manual* advancement — the user pressing a subtree-run button (CODING-689) —
asks the work instead: a child is *startable* when its own work is unsatisfied,
every blocker it declares is satisfied, and no agent run or terminal session is
live on that child. A stale launch fact on a sibling therefore costs one work
item rather than the whole campaign, and an agent the user started by hand is
still respected. :func:`manual_launch_candidates` is that policy, and both
manual modes route through the one :func:`is_startable` predicate so serial and
parallel cannot drift apart. A serial press adds one campaign-level rule on top
of it, also read from the work: while any child is live with unfinished work,
the press starts nothing, because serial ordering comes from sequence numbers
and a running child declares no blocker its siblings could honour.

Both policies are pure — the caller supplies the loaded children, the
satisfaction predicate, and the durable launch or liveness facts — so the policy
stays readable and independent of database access.
"""

from __future__ import annotations

from collections.abc import Callable, Container, Iterable, Sequence
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


def is_startable(
    child: Any,
    *,
    live_task_ids: Container,
    satisfied: Callable[[Any], bool],
) -> bool:
    """Return whether a manual press may start ``child`` right now.

    Three facts, all about the child rather than about the campaign: its own
    work is unsatisfied, no agent run or terminal session is live on it, and
    every blocker it declares is satisfied. Blockers outside the subtree stay
    authoritative because they are read from the child's own ``blocked_by``
    edges. Whether this root ever launched the child is *not* an input — a
    launch fact records what was started, and a stale one must not veto a
    press.
    """

    return (
        not satisfied(child)
        and str(child.id) not in live_task_ids
        and all(satisfied(blocker) for blocker in child.blocked_by.all())
    )


def startable_children(
    children: Sequence[Any],
    *,
    live_task_ids: Iterable,
    satisfied: Callable[[Any], bool],
) -> list[Any]:
    """Return every startable child in launch order.

    ``live_task_ids`` carries the per-work-item liveness facts the caller read
    for these children; ids are compared as strings so a caller may pass model
    keys or their string forms. Ordering is applied here rather than trusted
    from ``children`` so the policy is deterministic on its own terms.
    """

    live = {str(task_id) for task_id in live_task_ids}
    return sorted(
        (
            child
            for child in children
            if is_startable(child, live_task_ids=live, satisfied=satisfied)
        ),
        key=_launch_order,
    )


def manual_launch_candidates(
    children: Sequence[Any],
    *,
    execution_mode: str,
    live_task_ids: Iterable,
    satisfied: Callable[[Any], bool],
) -> list[Any]:
    """Choose the children one manual press should start, in launch order.

    A parallel press takes every startable child. A serial press takes exactly
    the lowest-ordered one — but only while the campaign is not already working:
    if any child still carries unfinished work *and* is live, that child holds
    the serial bound and the press starts nothing. Serial ordering here comes
    from the stored sequence number rather than from declared blockers, so
    without that hold a sibling of a running child would look perfectly
    startable and an impatient second press would put two agents inside a
    campaign whose whole contract is one at a time (CODING-728).

    The hold is derived from the *work* — per-work-item liveness plus
    satisfaction — never from the campaign's launch ledger. A stale
    ``LaunchedTask`` row therefore still cannot deadlock the press, and a child
    that reached satisfaction while its run record was never closed does not
    hold the campaign either (CODING-689).
    """

    live = {str(task_id) for task_id in live_task_ids}
    startable = startable_children(
        children,
        live_task_ids=live,
        satisfied=satisfied,
    )
    if execution_mode != SERIAL:
        return startable
    if _serial_press_held(children, live_task_ids=live, satisfied=satisfied):
        return []
    return startable[:1]


def _serial_press_held(
    children: Sequence[Any],
    *,
    live_task_ids: Container,
    satisfied: Callable[[Any], bool],
) -> bool:
    """Return whether a live, unfinished child holds this serial campaign.

    Only unsatisfied children count: a satisfied child whose agent run or
    terminal was never recorded as ended is finished work wearing a stale
    liveness fact, and the press exists precisely to get past those.
    """

    return any(
        not satisfied(child) and str(child.id) in live_task_ids for child in children
    )


def _launch_order(child: Any) -> tuple[int, str]:
    """Order by ascending stored sequence number, then opaque task id.

    The ticket number comes from the stored ``sequence_id``; a display key is
    never parsed for it.
    """

    return (child.sequence_id, str(child.id))
