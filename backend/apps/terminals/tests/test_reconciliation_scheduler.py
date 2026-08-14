from __future__ import annotations

from collections.abc import Callable

import pytest

import apps.terminals.reconciliation_scheduler as reconciliation_scheduler
from apps.terminals.reconciliation import reconcile_terminals
from apps.terminals.reconciliation_scheduler import (
    TerminalReconciliationScheduler,
)


@pytest.fixture(autouse=True)
def no_database_connection_cleanup(monkeypatch):
    """Keep scheduler unit tests independent of Django database access."""

    monkeypatch.setattr(
        reconciliation_scheduler,
        "close_old_connections",
        lambda: None,
    )


def test_scheduler_defers_reconciliation_and_coalesces_overlapping_requests():
    pending: list[Callable[[], None]] = []
    reconciliations: list[int] = []
    scheduler = TerminalReconciliationScheduler(
        reconcile=lambda: reconciliations.append(1),
        submit=pending.append,
    )

    assert scheduler.schedule() is True
    assert scheduler.schedule() is False
    assert reconciliations == []
    assert len(pending) == 1

    pending.pop()()

    assert reconciliations == [1]
    assert scheduler.schedule() is True
    assert len(pending) == 1


def test_scheduler_recovers_after_reconciliation_failure():
    pending: list[Callable[[], None]] = []
    attempts: list[int] = []

    def fail() -> None:
        attempts.append(1)
        raise RuntimeError("tmux exploded")

    scheduler = TerminalReconciliationScheduler(
        reconcile=fail,
        submit=pending.append,
    )

    assert scheduler.schedule() is True
    pending.pop()()
    assert attempts == [1]
    assert scheduler.schedule() is True


def test_scheduler_recovers_after_submission_failure():
    attempts: list[int] = []

    def reject(_job: Callable[[], None]) -> None:
        attempts.append(1)
        raise RuntimeError("executor unavailable")

    scheduler = TerminalReconciliationScheduler(
        reconcile=lambda: None,
        submit=reject,
    )

    assert scheduler.schedule() is False
    assert scheduler.schedule() is False
    assert attempts == [1, 1]


def test_worker_closes_thread_local_connections_around_reconciliation(monkeypatch):
    events: list[str] = []
    monkeypatch.setattr(
        reconciliation_scheduler,
        "close_old_connections",
        lambda: events.append("close"),
    )
    pending: list[Callable[[], None]] = []
    scheduler = TerminalReconciliationScheduler(
        reconcile=lambda: events.append("reconcile"),
        submit=pending.append,
    )

    scheduler.schedule()
    pending.pop()()

    assert events == ["close", "reconcile", "close"]


def test_scheduler_recovers_after_connection_cleanup_failure(monkeypatch):
    def explode() -> None:
        raise RuntimeError("connection pool unavailable")

    monkeypatch.setattr(
        reconciliation_scheduler,
        "close_old_connections",
        explode,
    )
    pending: list[Callable[[], None]] = []
    scheduler = TerminalReconciliationScheduler(
        reconcile=lambda: None,
        submit=pending.append,
    )

    scheduler.schedule()
    pending.pop()()

    assert scheduler.schedule() is True


def test_process_scheduler_requests_the_established_reconciler(monkeypatch):
    """The shared entry point defers to the one authoritative reconciler."""

    assert reconciliation_scheduler._scheduler._reconcile is reconcile_terminals

    jobs: list[Callable[[], None]] = []
    reconciled: list[int] = []
    monkeypatch.setattr(reconciliation_scheduler._scheduler, "_submit", jobs.append)
    monkeypatch.setattr(
        reconciliation_scheduler._scheduler,
        "_reconcile",
        lambda: reconciled.append(1),
    )

    assert reconciliation_scheduler.schedule_terminal_reconciliation() is True
    assert reconciliation_scheduler.schedule_terminal_reconciliation() is False
    assert reconciled == []

    jobs.pop()()

    assert reconciled == [1]
    assert jobs == []
