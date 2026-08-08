from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from apps.errors import ApplicationError
from apps.runs.chat import api as chat_api
from apps.runs.chat.codex_runtime import TurnStartError
from apps.runs.chat.events import append_event
from apps.runs.chat.jsonrpc import JsonRpcRemoteError
from apps.runs.models import (
    AgentChatLaunchCommand,
    AgentChatSession,
    AgentRun,
)
from worktracker.tests.factories import ensure_issue


pytestmark = pytest.mark.django_db(transaction=True)


def _run(*, run_id: str, kind: str = AgentRun.Kind.CHAT) -> AgentRun:
    issue = ensure_issue(
        project_id="chat-api-project",
        module_id="chat-api-module",
        task_id=f"task-{run_id}",
    )
    return AgentRun.objects.create(
        id=run_id,
        issue=issue,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        lifecycle_state="starting",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        cwd="/tmp/project",
        scope="task",
        run_kind=kind,
    )


def test_create_chat_route_passes_a_typed_launch_request(client, monkeypatch):
    captured = []

    def fake_create(body):
        captured.append(body)
        return {"agent_run_id": "chat-new"}

    monkeypatch.setattr(chat_api, "create_chat", fake_create)
    response = client.post(
        "/api/chats",
        data=json.dumps(
            {
                "agent": "codex",
                "project_id": "project-1",
                "module_id": "module-1",
                "task_id": "task-1",
                "initial_prompt": "Inspect this",
                "command_id": "create-command-1",
            }
        ),
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json() == {"agent_run_id": "chat-new"}
    assert captured == [
        chat_api.CreateChatRunBody(
            agent="codex",
            project_id="project-1",
            module_id="module-1",
            task_id="task-1",
            initial_prompt="Inspect this",
            command_id="create-command-1",
        )
    ]


def test_create_chat_rejects_non_codex_without_starting_supervisor(monkeypatch):
    monkeypatch.setattr(
        chat_api.runtime_supervisor,
        "call_sync",
        lambda *args, **kwargs: pytest.fail("runtime supervisor was called"),
    )

    with pytest.raises(ApplicationError) as raised:
        chat_api.create_chat(
            chat_api.CreateChatRunBody(
                agent="claude",
                project_id="project-1",
                module_id="module-1",
                task_id="task-1",
            )
        )

    assert getattr(raised.value, "code", None) == "chat_provider_unsupported"


def test_provider_jsonrpc_errors_map_to_declared_sanitized_api_failures(monkeypatch):
    monkeypatch.setattr(chat_api, "_spawn_request", lambda _body: object())
    monkeypatch.setattr(chat_api, "launch_intent_from_spawn", lambda _request: object())

    def fail_provider(*_args, **_kwargs):
        raise JsonRpcRemoteError(-32000, "token=provider-secret")

    monkeypatch.setattr(chat_api.runtime_supervisor, "call_sync", fail_provider)
    operations = [
        (
            lambda: chat_api.create_chat(
                chat_api.CreateChatRunBody(
                    project_id="project-1",
                    module_id="module-1",
                    task_id="task-1",
                )
            ),
            503,
            "chat_launch_unavailable",
        ),
        (
            lambda: chat_api.resume_chat("chat-1"),
            503,
            "chat_resume_unavailable",
        ),
        (lambda: chat_api.read_chat("chat-1"), 409, "chat_read_failed"),
        (
            lambda: chat_api.interrupt_chat("chat-1"),
            409,
            "chat_interrupt_failed",
        ),
    ]

    for operation, expected_status, expected_code in operations:
        with pytest.raises(ApplicationError) as raised:
            operation()
        assert raised.value.status_code == expected_status
        assert raised.value.code == expected_code
        assert "provider-secret" not in raised.value.message
        assert "[REDACTED]" in raised.value.message


def test_create_chat_command_is_durable_replayable_and_conflict_checked(monkeypatch):
    monkeypatch.setattr(chat_api, "_spawn_request", lambda _body: object())
    monkeypatch.setattr(chat_api, "launch_intent_from_spawn", lambda _request: object())
    launches = []

    async def fake_spawn(_intent, *, agent_run_id=None):
        launches.append(agent_run_id)
        return agent_run_id

    monkeypatch.setattr(chat_api.chat_session, "spawn", fake_spawn)
    monkeypatch.setattr(
        chat_api.runtime_supervisor,
        "call_sync",
        lambda operation, **_kwargs: asyncio.run(operation()),
    )
    body = chat_api.CreateChatRunBody(
        project_id="project-1",
        module_id="module-1",
        task_id="task-1",
        initial_prompt="Inspect this",
        command_id="create-durable-1",
    )

    first = chat_api.create_chat(body)
    second = chat_api.create_chat(body)

    assert first == second
    assert launches == [first["agent_run_id"]]
    command = AgentChatLaunchCommand.objects.get(command_id="create-durable-1")
    assert command.status == AgentChatLaunchCommand.Status.COMPLETED
    assert command.agent_run_id == first["agent_run_id"]

    with pytest.raises(ApplicationError) as conflict:
        chat_api.create_chat(body.model_copy(update={"initial_prompt": "Different"}))
    assert conflict.value.status_code == 409
    assert conflict.value.code == "command_id_conflict"
    assert launches == [first["agent_run_id"]]


def test_create_chat_command_retries_after_a_definite_failed_launch(monkeypatch):
    monkeypatch.setattr(chat_api, "_spawn_request", lambda _body: object())
    monkeypatch.setattr(chat_api, "launch_intent_from_spawn", lambda _request: object())
    launches = []

    async def flaky_spawn(_intent, *, agent_run_id=None):
        launches.append(agent_run_id)
        if len(launches) == 1:
            raise OSError("launch failed")
        return agent_run_id

    monkeypatch.setattr(chat_api.chat_session, "spawn", flaky_spawn)
    monkeypatch.setattr(
        chat_api.runtime_supervisor,
        "call_sync",
        lambda operation, **_kwargs: asyncio.run(operation()),
    )
    body = chat_api.CreateChatRunBody(
        project_id="project-1",
        module_id="module-1",
        task_id="task-1",
        command_id="create-retry-1",
    )

    with pytest.raises(ApplicationError) as failed:
        chat_api.create_chat(body)
    assert failed.value.code == "chat_launch_unavailable"
    command = AgentChatLaunchCommand.objects.get(command_id="create-retry-1")
    assert command.status == AgentChatLaunchCommand.Status.FAILED

    retried = chat_api.create_chat(body)

    assert retried == {"agent_run_id": launches[1]}
    assert launches[0] != launches[1]
    command.refresh_from_db()
    assert command.status == AgentChatLaunchCommand.Status.COMPLETED
    assert command.agent_run_id == launches[1]


def test_create_chat_pending_duplicate_never_launches_twice(monkeypatch):
    monkeypatch.setattr(chat_api, "_spawn_request", lambda _body: object())
    monkeypatch.setattr(chat_api, "launch_intent_from_spawn", lambda _request: object())
    body = chat_api.CreateChatRunBody(
        project_id="project-1",
        module_id="module-1",
        task_id="task-1",
        command_id="create-pending-1",
    )
    should_launch, _reserved_run_id = chat_api._claim_create_chat_command(
        body.command_id,
        chat_api._create_chat_fingerprint(body),
    )
    assert should_launch is True
    monkeypatch.setattr(
        chat_api.runtime_supervisor,
        "call_sync",
        lambda *_args, **_kwargs: pytest.fail("duplicate launch was attempted"),
    )

    with pytest.raises(ApplicationError) as pending:
        chat_api.create_chat(body)

    assert pending.value.status_code == 409
    assert pending.value.code == "command_in_progress"


def test_rest_turn_command_id_reaches_the_durable_service(monkeypatch):
    captured = []

    async def fake_send_turn(agent_run_id, prompt, *, command_id=None):
        captured.append((agent_run_id, prompt, command_id))
        return "turn-rest-1"

    monkeypatch.setattr(chat_api.chat_session, "send_turn", fake_send_turn)
    monkeypatch.setattr(
        chat_api.runtime_supervisor,
        "call_sync",
        lambda operation, **_kwargs: asyncio.run(operation()),
    )

    result = chat_api.send_turn(
        "chat-rest-1",
        chat_api.SendTurnBody(
            prompt="Continue",
            command_id="rest-turn-command-1",
        ),
    )

    assert result == {"turn_id": "turn-rest-1"}
    assert captured == [
        ("chat-rest-1", "Continue", "rest-turn-command-1")
    ]


def test_rest_turn_surfaces_delivery_unknown_code(monkeypatch):
    def fail_unknown(*_args, **_kwargs):
        raise TurnStartError("provider response was lost", delivery_unknown=True)

    monkeypatch.setattr(chat_api.runtime_supervisor, "call_sync", fail_unknown)

    with pytest.raises(ApplicationError) as raised:
        chat_api.send_turn(
            "chat-rest-unknown",
            chat_api.SendTurnBody(
                prompt="Possibly accepted",
                command_id="rest-turn-unknown",
            ),
        )

    assert raised.value.status_code == 409
    assert raised.value.code == "turn_delivery_unknown"


def test_snapshot_is_cursor_bounded_and_never_accepts_a_terminal_run(client):
    run = _run(run_id="chat-snapshot")
    AgentChatSession.objects.create(run=run)
    for index in range(1, 4):
        append_event(
            agent_run_id=run.id,
            event_type="thread.message-assistant-delta",
            payload={"delta": str(index)},
        )

    response = client.get(f"/api/chats/{run.id}?after=1&through=2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["cursor"] == 2
    assert payload["run"]["run_kind"] == "chat"
    assert payload["session"]["last_sequence"] == 3
    assert [event["sequence"] for event in payload["events"]] == [2]

    ahead = client.get(f"/api/chats/{run.id}?after=4")
    assert ahead.status_code == 409
    assert ahead.json() == {
        "detail": "chat_cursor_ahead",
        "code": "chat_cursor_ahead",
        "cursor": 3,
        "after": 4,
    }

    terminal = _run(run_id="terminal-snapshot", kind=AgentRun.Kind.TERMINAL)
    terminal_response = client.get(f"/api/chats/{terminal.id}")
    assert terminal_response.status_code == 404
    assert terminal_response.json()["code"] == "chat_not_found"


def test_list_chat_rows_include_scope_and_reconnect_cursor(client):
    run = _run(run_id="chat-list")
    AgentChatSession.objects.create(
        run=run,
        status=AgentChatSession.Status.RUNNING,
        active_turn_id="turn-1",
    )
    append_event(
        agent_run_id=run.id,
        event_type="thread.turn-started",
        payload={"turnId": "turn-1"},
    )

    response = client.get("/api/chats", {"task_id": str(run.issue_id)})

    assert response.status_code == 200
    row = response.json()[0]
    expected = {
        "agent_run_id": run.id,
        "task_id": str(run.issue_id),
        "module_id": str(run.issue.module_id),
        "status": "running",
        "active_turn_id": "turn-1",
        "last_sequence": 1,
    }
    assert {key: row[key] for key in expected} == expected


def test_turn_interrupt_and_stop_routes_use_chat_application_operations(
    client, monkeypatch
):
    calls = []

    def fake_turn(run_id, body):
        calls.append(("turn", run_id, body.prompt, body.command_id))
        return {"turn_id": "turn-2"}

    def fake_interrupt(run_id):
        calls.append(("interrupt", run_id))
        return {"interrupted": True}

    def fake_stop(run_id):
        calls.append(("stop", run_id))
        return {
            "agent_run_id": run_id,
            "stopped": True,
            "stopped_live_process": True,
        }

    monkeypatch.setattr(chat_api, "send_turn", fake_turn)
    monkeypatch.setattr(chat_api, "interrupt_chat", fake_interrupt)
    monkeypatch.setattr(chat_api, "stop_chat", fake_stop)

    turn = client.post(
        "/api/chats/chat-1/turns",
        data=json.dumps(
            {"prompt": "Continue", "command_id": "rest-turn-command-2"}
        ),
        content_type="application/json",
    )
    interrupt = client.post("/api/chats/chat-1/interrupt")
    stopped = client.delete("/api/chats/chat-1")

    assert turn.json() == {"turn_id": "turn-2"}
    assert interrupt.json() == {"interrupted": True}
    assert stopped.json() == {
        "agent_run_id": "chat-1",
        "stopped": True,
        "stopped_live_process": True,
    }
    assert calls == [
        ("turn", "chat-1", "Continue", "rest-turn-command-2"),
        ("interrupt", "chat-1"),
        ("stop", "chat-1"),
    ]


def test_generated_openapi_declares_chat_creation_snapshot_and_commands():
    contract = Path(__file__).resolve().parents[5] / "openapi.json"
    schema = json.loads(contract.read_text(encoding="utf-8"))

    assert {"get", "post"} <= schema["paths"]["/chats"].keys()
    assert {"get", "delete"} <= schema["paths"]["/chats/{agent_run_id}"].keys()
    assert "post" in schema["paths"]["/chats/{agent_run_id}/turns"]
    assert "post" in schema["paths"]["/chats/{agent_run_id}/interrupt"]
    assert "post" in schema["paths"]["/chats/{agent_run_id}/approvals"]
    assert "post" in schema["paths"]["/chats/{agent_run_id}/user-input"]
    assert "post" in schema["paths"]["/chats/{agent_run_id}/resume"]
