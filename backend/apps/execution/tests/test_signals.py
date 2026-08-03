from __future__ import annotations

import logging

import pytest

from apps.execution import signals
from apps.runs.signals import publish_work_item_state
from worktracker.signals import issue_state_changed


_RUNS_DISPATCH_UID = "runs_publish_work_item_state"


@pytest.fixture
def without_status_feed_receiver():
    """Drive ``issue_state_changed`` with only the execution receivers attached.

    These tests hand-build a partial payload to exercise one receiver. The
    ``apps.runs`` status-feed receiver expects the full documented payload and
    reads the committed row, so it is detached here rather than being made
    tolerant of a test's convenience.
    """

    issue_state_changed.disconnect(dispatch_uid=_RUNS_DISPATCH_UID)
    yield
    issue_state_changed.connect(
        publish_work_item_state, dispatch_uid=_RUNS_DISPATCH_UID
    )


def test_receiver_delegates_completion(monkeypatch, without_status_feed_receiver):
    seen = {}

    def observe(*, issue_id):
        seen["issue_id"] = issue_id

    monkeypatch.setattr(signals.driver, "observe_issue_state_changed", observe)

    issue_state_changed.send(
        sender=object,
        issue_id="task-1",
        from_group="unstarted",
        to_group="unstarted",
        to_state_id="state-any",
    )

    assert seen == {"issue_id": "task-1"}


def test_receiver_swallows_observer_errors(monkeypatch, caplog):
    def fail(*, issue_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(signals.driver, "observe_issue_state_changed", fail)

    with caplog.at_level(logging.ERROR):
        signals.observe_completion(
            sender=object,
            issue_id="task-1",
            from_group="started",
            to_group="completed",
        )

    assert "execution observer failed issue=task-1" in caplog.text
