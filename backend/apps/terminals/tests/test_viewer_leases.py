from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.utils import timezone

from apps.runs.models import AgentRun
from apps.terminals.models import AgentRunViewerLease
from apps.terminals import viewer_leases
from apps.terminals.session import AttachHandle
from apps.terminals.session_registry import PtySession, SESSIONS, TMUX_VIEWERS
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)


def _run(run_id: str = "run-lease") -> AgentRun:
    return AgentRun.objects.create(
        id=run_id,
        issue_id=fixture_issue_id(
            project_id="project-1", module_id="module-1", task_id="task-1"
        ),
        agent="claude",
        status="running",
        started_at="2026-07-22T00:00:00+00:00",
        cwd="/tmp",
        scope="task",
    )


def test_newest_viewer_replaces_previous_without_touching_the_run():
    run = _run()

    first = viewer_leases.acquire(
        agent_run_id=run.id, viewer_id="browser-one", transport="browser"
    )
    replacement = viewer_leases.acquire(
        agent_run_id=run.id, viewer_id="desktop-two", transport="desktop"
    )

    assert first.replaced_viewer_id is None
    assert replacement.replaced_viewer_id == "browser-one"
    assert replacement.replaced_transport == "browser"
    assert AgentRun.objects.get(id=run.id).ended_at is None
    assert AgentRunViewerLease.objects.get(agent_run_id=run.id).viewer_id == "desktop-two"


def test_duplicate_attach_is_idempotent_and_only_the_holder_can_release():
    run = _run()
    viewer_leases.acquire(agent_run_id=run.id, viewer_id="browser-one", transport="browser")

    duplicate = viewer_leases.acquire(
        agent_run_id=run.id, viewer_id="browser-one", transport="browser"
    )

    assert duplicate.replaced_viewer_id is None
    assert not viewer_leases.release(agent_run_id=run.id, viewer_id="desktop-two")
    assert viewer_leases.release(agent_run_id=run.id, viewer_id="browser-one")
    assert not AgentRunViewerLease.objects.filter(agent_run_id=run.id).exists()


def test_stale_lease_is_recoverable_and_renewal_reports_the_displaced_viewer():
    run = _run()
    viewer_leases.acquire(agent_run_id=run.id, viewer_id="browser-one", transport="browser")
    AgentRunViewerLease.objects.filter(agent_run_id=run.id).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )

    replacement = viewer_leases.acquire(
        agent_run_id=run.id, viewer_id="desktop-two", transport="desktop"
    )

    assert replacement.replaced_viewer_id == "browser-one"
    assert viewer_leases.renew(agent_run_id=run.id, viewer_id="browser-one") is None
    assert viewer_leases.renew(agent_run_id=run.id, viewer_id="desktop-two") is not None


def test_browser_registry_acquires_and_releases_the_durable_lease():
    run = _run()
    handle = AttachHandle(
        agent_run_id=run.id,
        viewer_id="browser-one",
        session=SimpleNamespace(),
    )
    viewer = PtySession(
        session_id="browser-one",
        pty=SimpleNamespace(),
        agent="claude",
        task_id="task-1",
        module_id="module-1",
        agent_run_id=run.id,
    )

    assert handle.activate(viewer) is None
    assert TMUX_VIEWERS[run.id] == "browser-one"
    assert AgentRunViewerLease.objects.get(agent_run_id=run.id).viewer_id == "browser-one"

    handle.release()
    assert run.id not in TMUX_VIEWERS
    assert not AgentRunViewerLease.objects.filter(agent_run_id=run.id).exists()
    SESSIONS.clear()
