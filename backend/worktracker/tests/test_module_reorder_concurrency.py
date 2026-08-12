"""Two first drags racing for the same project (#360).

Both requests believe the project is still automatic, so both carry a baseline.
They serialize on the project row: the winner seeds the canonical order, and the
loser's baseline is stale the moment it acquires the lock, so it may move only
its own module against the ranks the winner just wrote.

A sequential pair of calls cannot show that, because the second call never meets
a transaction that is still open. So the contended case is built for real: two
threads on their own connections, with the winner made to hold its transaction
open — seed already written, nothing committed — until the second request is
inside the service. The loser therefore arrives at a project row another
transaction owns.

Where the loser waits depends on the database: Postgres parks it inside
``select_for_update``, while SQLite — which this suite runs on — makes it wait on
the database write lock for the length of its busy timeout. Either way it does
not get to look at the project row until the winner has committed, and it then
finds a manual project and a baseline that no longer describes anything.
:func:`_request` also retries, for the databases that report contention as an
error rather than waiting; a retry is the same late request arriving again.
"""

import threading
import time

import pytest
from django.db import OperationalError, connection

from worktracker.services import module_reorder
from worktracker.services.work_items import reorder_work_item
from worktracker.tests.module_reorder_fixtures import (  # noqa: F401 - pytest fixture
    modules,
)
from worktracker.tests.module_reorder_fixtures import (
    baseline,
    module_names,
    ranks_by_name,
)


# Long enough for the loser to reach the contended row and be turned away, short
# enough that the test costs a fraction of a second.
HOLD_SECONDS = 0.25

# The loser keeps re-requesting for well past the hold, as a caller racing
# another writer would.
RETRY_PAUSE = 0.05
RETRY_LIMIT = 40


def _request(call):
    """Run one reorder request on this thread's own database connection.

    A request the database turns away is retried, exactly as a caller racing
    another writer would be: the same first-drag request arriving late, still
    carrying the baseline it saw before the winner seeded anything.
    """

    try:
        for attempt in range(RETRY_LIMIT):
            try:
                return call()
            except OperationalError:
                if attempt == RETRY_LIMIT - 1:
                    raise
                time.sleep(RETRY_PAUSE)
    finally:
        connection.close()


class ContendedFirstDrag:
    """Two first drags, the loser guaranteed to meet a held project row.

    The winner pauses inside its own transaction once its seed is written, and
    only then is the loser allowed to start. Neither request is otherwise
    altered: both go through the public reorder service with the baseline their
    caller saw.
    """

    def __init__(self, monkeypatch):
        self.seeded = threading.Event()
        self.loser_started = threading.Event()
        seed_manual_order = module_reorder._seed_manual_order

        def seed_then_hold(project_id, initial_order_ids):
            seed_manual_order(project_id, initial_order_ids)
            self.seeded.set()
            self.loser_started.wait(timeout=10)
            time.sleep(HOLD_SECONDS)

        monkeypatch.setattr(module_reorder, "_seed_manual_order", seed_then_hold)

    def run(self, winner, loser):
        """Run both requests and re-raise on the test's own thread."""

        failures = []

        def winning_request():
            self._guard(failures, lambda: _request(winner))

        def losing_request():
            self.seeded.wait(timeout=10)
            self.loser_started.set()
            self._guard(failures, lambda: _request(loser))

        threads = [
            threading.Thread(target=winning_request),
            threading.Thread(target=losing_request),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        assert not any(thread.is_alive() for thread in threads), (
            "a reorder request never finished — the project row is still locked"
        )
        if failures:
            raise failures[0]

        assert self.seeded.is_set() and self.loser_started.is_set(), (
            "the requests never overlapped, so nothing was serialized"
        )

    @staticmethod
    def _guard(failures, call):
        try:
            call()
        except BaseException as exc:  # re-raised on the test's thread
            failures.append(exc)


@pytest.fixture
def contended_first_drag(monkeypatch):
    return ContendedFirstDrag(monkeypatch)


@pytest.mark.django_db(transaction=True)
def test_a_first_drag_meeting_a_held_project_row_waits_for_the_winner(
    project, modules, contended_first_drag
):
    """The winner seeds and moves; the loser then moves only its own module.

    Both requests see the same automatic order (c, b, a) and send it as their
    baseline. The winner drags a to the top while holding the row; the loser
    drags c to the bottom. Re-seeding that stale baseline would put a back where
    it started, so the settled order is what proves the loser did not.
    """

    visible = baseline(modules, "c", "b", "a")

    contended_first_drag.run(
        winner=lambda: reorder_work_item(
            modules["a"].id,
            before_id=None,
            after_id=modules["c"].id,
            initial_order_ids=visible,
        ),
        loser=lambda: reorder_work_item(
            modules["c"].id,
            before_id=modules["a"].id,
            after_id=None,
            initial_order_ids=visible,
        ),
    )

    project.refresh_from_db()
    assert project.manual_module_order is True
    assert module_names(project) == ["a", "b", "c"]

    # The seed ran once: b, which neither request dragged, still holds the rank
    # it was seeded with, and a still holds the rank the winner gave it under
    # the lock — a re-seed would have reset both.
    ranks = ranks_by_name(project)
    assert ranks["b"] == "V"
    assert ranks["a"] == "7kV"
    assert ranks["c"] > ranks["b"]


@pytest.mark.django_db
def test_a_request_arriving_after_manual_mode_ignores_its_stale_baseline(
    project, modules
):
    """The late request must move only its own module against current ranks.

    This is the loser's half of the race with the interleaving already decided,
    so the ranks it must leave alone can be named exactly.
    """

    # Winner: seeds c, b, a and drags a to the top.
    reorder_work_item(
        modules["a"].id,
        before_id=None,
        after_id=modules["c"].id,
        initial_order_ids=baseline(modules, "c", "b", "a"),
    )
    seeded = ranks_by_name(project)

    # Loser: same gesture era, a baseline that disagrees, dragging b to the top.
    reorder_work_item(
        modules["b"].id,
        before_id=None,
        after_id=modules["a"].id,
        initial_order_ids=baseline(modules, "a", "b", "c"),
    )

    settled = ranks_by_name(project)
    assert settled["a"] == seeded["a"] and settled["c"] == seeded["c"]
    assert module_names(project) == ["b", "a", "c"]
