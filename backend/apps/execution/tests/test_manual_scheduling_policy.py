"""The manual startable-child policy, observed as selected child ids (CODING-719).

These exercise the pure policy directly with stand-in children, so they state
the rule without a database: what a press starts, what it declines to start,
and in which order. The driver's own graph suites remain the seam that proves
the policy is wired to real work items.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from apps.execution.execution_mode import PARALLEL, SERIAL
from apps.execution.scheduling import (
    is_startable,
    manual_launch_candidates,
    startable_children,
)


@dataclass
class FakeChild:
    """A direct child carrying only what the policy reads."""

    id: str
    sequence_id: int
    done: bool = False
    blockers: list["FakeChild"] = field(default_factory=list)

    @property
    def blocked_by(self):
        return _Edges(self.blockers)


@dataclass
class _Edges:
    rows: list[FakeChild]

    def all(self):
        return list(self.rows)


def satisfied(child: FakeChild) -> bool:
    return child.done


def selected(children, *, mode, live=()):
    return [
        child.id
        for child in manual_launch_candidates(
            children,
            execution_mode=mode,
            live_task_ids=live,
            satisfied=satisfied,
        )
    ]


def test_unsatisfied_unblocked_idle_child_is_startable():
    child = FakeChild(id="a", sequence_id=1)

    assert is_startable(child, live_task_ids=set(), satisfied=satisfied)


def test_satisfied_child_is_never_started():
    children = [FakeChild(id="a", sequence_id=1, done=True)]

    assert selected(children, mode=PARALLEL) == []
    assert selected(children, mode=SERIAL) == []


def test_unsatisfied_blocker_withholds_its_child():
    blocker = FakeChild(id="blocker", sequence_id=1)
    child = FakeChild(id="a", sequence_id=2, blockers=[blocker])

    assert selected([child], mode=PARALLEL) == []


def test_satisfied_blocker_releases_its_child():
    blocker = FakeChild(id="blocker", sequence_id=1, done=True)
    child = FakeChild(id="a", sequence_id=2, blockers=[blocker])

    assert selected([child], mode=PARALLEL) == ["a"]


def test_blocker_outside_the_subtree_stays_authoritative():
    # The blocker is not among the children being selected over, so only the
    # child's own edge can withhold it.
    external = FakeChild(id="external", sequence_id=99)
    child = FakeChild(id="a", sequence_id=1, blockers=[external])

    assert selected([child], mode=PARALLEL) == []
    assert selected([child], mode=SERIAL) == []


def test_live_child_is_excluded():
    children = [FakeChild(id="a", sequence_id=1), FakeChild(id="b", sequence_id=2)]

    assert selected(children, mode=PARALLEL, live={"a"}) == ["b"]


def test_live_child_is_excluded_whoever_started_it():
    # Liveness is a fact about the work item, not about the campaign's ledger,
    # so a run the user launched by hand excludes the child just the same.
    children = [FakeChild(id="a", sequence_id=1)]

    assert selected(children, mode=SERIAL, live={"a"}) == []


def test_a_launch_fact_is_not_an_exclusion_input():
    # The policy takes no launched-task ids at all: a child whose recorded run
    # has ended is startable again, so a stale fact cannot veto the press.
    children = [FakeChild(id="a", sequence_id=1)]

    assert selected(children, mode=SERIAL, live=()) == ["a"]


def test_a_stale_fact_on_a_sibling_costs_only_that_sibling():
    finished = FakeChild(id="finished", sequence_id=1, done=True)
    waiting = FakeChild(id="waiting", sequence_id=2)

    assert selected([finished, waiting], mode=SERIAL) == ["waiting"]


def test_serial_takes_the_lowest_stored_sequence():
    children = [
        FakeChild(id="third", sequence_id=30),
        FakeChild(id="first", sequence_id=10),
        FakeChild(id="second", sequence_id=20),
    ]

    assert selected(children, mode=SERIAL) == ["first"]


def test_serial_skips_a_lower_child_that_cannot_start():
    blocker = FakeChild(id="blocker", sequence_id=1)
    children = [
        FakeChild(id="blocked", sequence_id=10, blockers=[blocker]),
        FakeChild(id="next", sequence_id=30),
    ]

    assert selected(children, mode=SERIAL) == ["next"]


def test_serial_press_starts_nothing_beside_a_live_unfinished_child():
    # Serial ordering comes from the sequence number, not from declared
    # blockers, so a running child leaves its siblings looking startable. The
    # campaign's one-at-a-time bound is what holds them (CODING-728).
    children = [
        FakeChild(id="running", sequence_id=10),
        FakeChild(id="next", sequence_id=20),
        FakeChild(id="last", sequence_id=30),
    ]

    assert selected(children, mode=SERIAL, live={"running"}) == []


def test_a_live_child_holds_a_serial_press_from_wherever_it_sits():
    # The hold is campaign-wide: a live child ordered *after* an idle one still
    # means the campaign is working, so nothing else starts.
    children = [
        FakeChild(id="idle", sequence_id=10),
        FakeChild(id="running", sequence_id=20),
    ]

    assert selected(children, mode=SERIAL, live={"running"}) == []


def test_a_live_child_never_holds_a_parallel_press():
    children = [
        FakeChild(id="running", sequence_id=10),
        FakeChild(id="next", sequence_id=20),
    ]

    assert selected(children, mode=PARALLEL, live={"running"}) == ["next"]


def test_a_satisfied_child_with_a_stale_live_fact_holds_nothing():
    # Its run record was never closed, but the work is finished — that is the
    # deadlock the press exists to get past, so the campaign is not working.
    children = [
        FakeChild(id="finished", sequence_id=10, done=True),
        FakeChild(id="waiting", sequence_id=20),
    ]

    assert selected(children, mode=SERIAL, live={"finished"}) == ["waiting"]


def test_shared_sequence_breaks_ties_on_opaque_task_id():
    children = [
        FakeChild(id="b", sequence_id=10),
        FakeChild(id="a", sequence_id=10),
    ]

    assert selected(children, mode=SERIAL) == ["a"]


def test_parallel_takes_every_startable_child_in_order():
    children = [
        FakeChild(id="c", sequence_id=30),
        FakeChild(id="a", sequence_id=10),
        FakeChild(id="done", sequence_id=15, done=True),
        FakeChild(id="b", sequence_id=20),
    ]

    assert selected(children, mode=PARALLEL) == ["a", "b", "c"]


def test_both_modes_select_from_the_same_startable_set():
    children = [
        FakeChild(id="c", sequence_id=30),
        FakeChild(id="a", sequence_id=10),
        FakeChild(id="b", sequence_id=20),
    ]
    children[1].done = True  # "a" is finished, so it holds no serial campaign.
    shared = [
        child.id
        for child in startable_children(
            children, live_task_ids={"a"}, satisfied=satisfied
        )
    ]

    assert shared == ["b", "c"]
    assert selected(children, mode=PARALLEL, live={"a"}) == shared
    assert selected(children, mode=SERIAL, live={"a"}) == shared[:1]


def test_nothing_startable_selects_nothing():
    children = [FakeChild(id="a", sequence_id=1, done=True)]

    assert selected(children, mode=PARALLEL) == []
    assert selected(children, mode=SERIAL) == []


@pytest.mark.parametrize("mode", [SERIAL, PARALLEL])
def test_liveness_ids_compare_as_strings(mode):
    # Callers may hand over model keys rather than their string forms.
    class Key:
        def __str__(self):
            return "a"

    children = [FakeChild(id="a", sequence_id=1)]

    assert selected(children, mode=mode, live=[Key()]) == []
