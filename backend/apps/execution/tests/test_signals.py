from __future__ import annotations

import logging

from apps.execution import signals
from apps.terminals.termination_seam import agent_run_terminated
from worktracker.signals import issue_state_changed


def test_receiver_delegates_completion(monkeypatch):
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


def test_receiver_delegates_agent_run_termination(monkeypatch):
    seen = {}

    def observe(*, agent_run_id):
        seen["agent_run_id"] = agent_run_id

    monkeypatch.setattr(signals.driver, "observe_agent_run_terminated", observe)

    agent_run_terminated.send(sender=None, agent_run_id="run-1")

    assert seen == {"agent_run_id": "run-1"}


def test_receiver_swallows_agent_run_termination_errors(monkeypatch, caplog):
    def fail(*, agent_run_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(signals.driver, "observe_agent_run_terminated", fail)

    with caplog.at_level(logging.ERROR):
        signals.observe_agent_run_completion(sender=None, agent_run_id="run-1")

    assert "execution observer failed agent_run=run-1" in caplog.text
