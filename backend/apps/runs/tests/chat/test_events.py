import pytest

from apps.runs.chat.events import append_event, replay_events
from apps.runs.models import AgentChatSession, AgentRun
from worktracker.tests.factories import fixture_issue_id


TASK_ID = fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1")


@pytest.mark.django_db
def test_chat_events_allocate_a_durable_run_local_cursor():
    run = AgentRun.objects.create(
        id="chat-run-1",
        issue_id=TASK_ID,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        lifecycle_state="starting",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    AgentChatSession.objects.create(run=run)

    first = append_event(
        agent_run_id=run.id,
        event_type="thread.message-sent",
        payload={"role": "user", "text": "Inspect the code"},
    )
    second = append_event(
        agent_run_id=run.id,
        event_type="thread.message-assistant-delta",
        payload={"delta": "I am looking."},
    )

    assert (first.sequence, second.sequence) == (1, 2)
    assert AgentChatSession.objects.get(run=run).next_sequence == 3
    assert replay_events(agent_run_id=run.id, after=1) == [second]


@pytest.mark.django_db
def test_terminal_is_the_default_agent_run_kind():
    run = AgentRun.objects.create(
        id="terminal-run-1",
        issue_id=TASK_ID,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        scope="task",
    )

    assert run.run_kind == AgentRun.Kind.TERMINAL
