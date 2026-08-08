import pytest

from apps.runs.chat.api import _claim_create_chat_command
from apps.runs.chat.events import append_event, replay_events
from apps.runs.chat.supervision import (
    RESTART_DELIVERY_UNKNOWN,
    reconcile_orphaned_commands,
    reconcile_orphaned_sessions,
)
from apps.runs.models import (
    AgentChatCommand,
    AgentChatLaunchCommand,
    AgentChatSession,
    AgentRun,
)
from worktracker.tests.factories import ensure_issue, fixture_issue_id


@pytest.mark.parametrize(
    "session_status",
    [
        AgentChatSession.Status.STARTING,
        AgentChatSession.Status.READY,
        AgentChatSession.Status.RUNNING,
        AgentChatSession.Status.ERROR,
        AgentChatSession.Status.INTERRUPTED,
    ],
)
@pytest.mark.django_db
def test_restart_reconciliation_preserves_thread_and_marks_session_resumable(
    session_status,
):
    run = AgentRun.objects.create(
        id=f"chat-orphan-{session_status}",
        issue_id=fixture_issue_id(
            project_id="proj-1", module_id="mod-1", task_id="task-1"
        ),
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    AgentChatSession.objects.create(
        run=run,
        provider_thread_id="provider-thread-1",
        status=session_status,
        active_turn_id="turn-1",
        resume_token="stale-resume-token",
    )

    assert reconcile_orphaned_sessions() == 1

    session = AgentChatSession.objects.get(run=run)
    assert session.status == AgentChatSession.Status.INTERRUPTED
    assert session.active_turn_id is None
    assert session.provider_thread_id == "provider-thread-1"
    assert session.resume_token is None
    run.refresh_from_db()
    assert run.status == "interrupted"
    assert run.ended_at is None
    assert run.lifecycle_state == "quiet"
    assert run.error == session.last_error
    event = replay_events(agent_run_id=run.id)[0]
    assert event.event_type == "thread.session-interrupted"
    assert event.payload == {
        "reason": "backend_restart",
        "resumable": True,
        "activeTurnId": "turn-1",
    }
    assert reconcile_orphaned_sessions() == 0
    assert len(replay_events(agent_run_id=run.id)) == 1


@pytest.mark.django_db
def test_restart_reconciliation_marks_pre_thread_launch_non_resumable():
    run = AgentRun.objects.create(
        id="chat-orphan-without-thread",
        issue_id=fixture_issue_id(
            project_id="proj-1", module_id="mod-1", task_id="task-1"
        ),
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    AgentChatSession.objects.create(
        run=run,
        provider_thread_id=None,
        status=AgentChatSession.Status.STARTING,
        active_turn_id=None,
        resume_token="stale-resume-token",
    )

    assert reconcile_orphaned_sessions() == 1

    session = AgentChatSession.objects.get(run=run)
    assert session.status == AgentChatSession.Status.ERROR
    assert session.active_turn_id is None
    assert session.provider_thread_id is None
    assert session.resume_token is None
    run.refresh_from_db()
    assert run.status == "exited"
    assert run.ended_at is not None
    assert run.lifecycle_state == "error"
    assert run.ended_at == run.lifecycle_updated_at
    assert run.error == session.last_error
    event = replay_events(agent_run_id=run.id)[0]
    assert event.event_type == "thread.error"
    assert event.payload == {
        "phase": "backend_restart",
        "message": session.last_error,
        "resumable": False,
        "activeTurnId": None,
    }
    assert reconcile_orphaned_sessions() == 0
    assert len(replay_events(agent_run_id=run.id)) == 1


@pytest.mark.django_db
def test_restart_reconciliation_completes_launch_claim_for_existing_thread():
    run = AgentRun.objects.create(
        id="chat-launch-claim-resumable",
        issue_id=ensure_issue(
            project_id="proj-launch", module_id="mod-launch", task_id="task-launch"
        ).id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    AgentChatSession.objects.create(
        run=run,
        provider_thread_id="provider-launch-thread",
        status=AgentChatSession.Status.READY,
    )
    command = AgentChatLaunchCommand.objects.create(
        command_id="launch-command-resumable",
        request_fingerprint="a" * 64,
        agent_run_id=run.id,
    )

    assert reconcile_orphaned_commands() == 1

    command.refresh_from_db()
    assert command.status == AgentChatLaunchCommand.Status.COMPLETED
    assert command.error is None


@pytest.mark.django_db
def test_restart_marks_unacknowledged_initial_turn_unknown_without_relaunch():
    run = AgentRun.objects.create(
        id="chat-launch-initial-unknown",
        issue_id=ensure_issue(
            project_id="proj-initial-unknown",
            module_id="mod-initial-unknown",
            task_id="task-initial-unknown",
        ).id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    session = AgentChatSession.objects.create(
        run=run,
        provider_thread_id="provider-initial-unknown",
        status=AgentChatSession.Status.READY,
    )
    launch = AgentChatLaunchCommand.objects.create(
        command_id="launch-with-initial-unknown",
        request_fingerprint="c" * 64,
        agent_run_id=run.id,
    )
    initial = AgentChatCommand.objects.create(
        session=session,
        command_id="initial-turn-command",
        command_type="start_turn",
        request_fingerprint="d" * 64,
    )
    append_event(
        agent_run_id=run.id,
        event_type="thread.message-sent",
        payload={
            "id": initial.command_id,
            "role": "user",
            "text": "Original launch intent",
        },
    )

    assert reconcile_orphaned_commands() == 2
    assert reconcile_orphaned_sessions() == 1

    launch.refresh_from_db()
    initial.refresh_from_db()
    assert launch.status == AgentChatLaunchCommand.Status.COMPLETED
    assert initial.status == AgentChatCommand.Status.FAILED
    assert initial.error == RESTART_DELIVERY_UNKNOWN
    failure = replay_events(agent_run_id=run.id)[-2]
    assert failure.event_type == "thread.message-failed"
    assert failure.payload["deliveryUnknown"] is True
    assert failure.payload["retryable"] is False

    should_launch, existing_run_id = _claim_create_chat_command(
        launch.command_id,
        launch.request_fingerprint,
    )
    assert should_launch is False
    assert existing_run_id == run.id


@pytest.mark.django_db
def test_restart_reconciliation_allows_safe_retry_of_pre_thread_launch():
    run = AgentRun.objects.create(
        id="chat-launch-claim-pre-thread",
        issue_id=ensure_issue(
            project_id="proj-pre", module_id="mod-pre", task_id="task-pre"
        ).id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    AgentChatSession.objects.create(
        run=run,
        status=AgentChatSession.Status.STARTING,
    )
    command = AgentChatLaunchCommand.objects.create(
        command_id="launch-command-pre-thread",
        request_fingerprint="b" * 64,
        agent_run_id=run.id,
    )

    assert reconcile_orphaned_commands() == 1
    assert reconcile_orphaned_sessions() == 1
    command.refresh_from_db()
    assert command.status == AgentChatLaunchCommand.Status.FAILED

    should_launch, retry_run_id = _claim_create_chat_command(
        command.command_id,
        command.request_fingerprint,
    )
    command.refresh_from_db()
    assert should_launch is True
    assert retry_run_id != run.id
    assert command.status == AgentChatLaunchCommand.Status.PENDING
    assert command.agent_run_id == retry_run_id


@pytest.mark.django_db
def test_restart_reconciliation_recovers_or_releases_pending_turn_claims():
    issue_id = ensure_issue(
        project_id="proj-turn", module_id="mod-turn", task_id="task-turn"
    ).id
    safe_run = AgentRun.objects.create(
        id="chat-turn-claim-not-delivered",
        issue_id=issue_id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    safe_session = AgentChatSession.objects.create(run=safe_run)
    AgentChatCommand.objects.create(
        session=safe_session,
        command_id="safe-retry-command",
        command_type="start_turn",
    )

    started_run = AgentRun.objects.create(
        id="chat-turn-claim-started",
        issue_id=issue_id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    started_session = AgentChatSession.objects.create(run=started_run)
    started_command = AgentChatCommand.objects.create(
        session=started_session,
        command_id="started-command",
        command_type="start_turn",
    )
    append_event(
        agent_run_id=started_run.id,
        event_type="thread.message-sent",
        payload={"id": started_command.command_id, "role": "user"},
    )
    append_event(
        agent_run_id=started_run.id,
        event_type="thread.turn-started",
        payload={"turn": {"id": "recovered-turn"}},
    )

    unknown_run = AgentRun.objects.create(
        id="chat-turn-claim-unknown",
        issue_id=issue_id,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    unknown_session = AgentChatSession.objects.create(run=unknown_run)
    unknown_command = AgentChatCommand.objects.create(
        session=unknown_session,
        command_id="unknown-command",
        command_type="start_turn",
    )
    append_event(
        agent_run_id=unknown_run.id,
        event_type="thread.message-sent",
        payload={"id": unknown_command.command_id, "role": "user"},
    )

    assert reconcile_orphaned_commands() == 3

    assert not AgentChatCommand.objects.filter(
        session=safe_session,
        command_id="safe-retry-command",
    ).exists()
    started_command.refresh_from_db()
    assert started_command.status == AgentChatCommand.Status.COMPLETED
    assert started_command.result == {"turn_id": "recovered-turn"}
    unknown_command.refresh_from_db()
    assert unknown_command.status == AgentChatCommand.Status.FAILED
    assert unknown_command.error == RESTART_DELIVERY_UNKNOWN
    assert replay_events(agent_run_id=unknown_run.id)[-1].payload == {
        "id": "unknown-command",
        "role": "user",
        "phase": "backend_restart",
        "error": RESTART_DELIVERY_UNKNOWN,
        "deliveryUnknown": True,
        "retryable": False,
    }
