"""Public WebSocket behavior for durable Chat transcripts."""

import asyncio
import sys
from urllib.parse import urlencode

import pytest
from asgiref.sync import sync_to_async
from channels.testing.websocket import WebsocketCommunicator
from django.db import transaction
from django.test import override_settings

from apps.runs.chat import consumer
from apps.runs.chat.codex_runtime import (
    CodexChatRuntime,
    TurnStartError,
    runtime_registry,
)
from apps.runs.chat.events import append_event
from apps.runs.chat.runtime_supervisor import runtime_supervisor
from apps.runs.models import AgentChatSession, AgentRun
from studio_server.asgi import application
from worktracker.tests.factories import fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)
PROJECT_ID = fixture_uuid("proj-1")
MODULE_ID = fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id=None)
TASK_ID = fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1")

COMMAND_PEER = r"""
import json
import sys

for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if "id" not in frame:
        continue
    if method == "initialize":
        print(json.dumps({"id": frame["id"], "result": {"userAgent": "fake"}}), flush=True)
    elif method == "thread/start":
        print(json.dumps({"id": frame["id"], "result": {"thread": {"id": "thread-1"}}}), flush=True)
    elif method == "turn/start":
        print(json.dumps({"id": frame["id"], "result": {"turn": {"id": "turn-1"}}}), flush=True)
        print(json.dumps({"method": "turn/started", "params": {"threadId": "thread-1", "turn": {"id": "turn-1"}}}), flush=True)
        print(json.dumps({
            "id": "provider-approval",
            "method": "item/commandExecution/requestApproval",
            "params": {
                "command": "pytest",
                "itemId": "command-1",
                "startedAtMs": 1,
                "threadId": "thread-1",
                "turnId": "turn-1",
            },
        }), flush=True)
        json.loads(sys.stdin.readline())
        print(json.dumps({
            "id": "provider-user-input",
            "method": "item/tool/requestUserInput",
            "params": {
                "isBlocking": True,
                "itemId": "tool-1",
                "questions": [{"id": "scope", "header": "Scope", "question": "Which scope?"}],
                "threadId": "thread-1",
                "turnId": "turn-1",
            },
        }), flush=True)
        json.loads(sys.stdin.readline())
    elif method == "turn/interrupt":
        print(json.dumps({"id": frame["id"], "result": {}}), flush=True)
        print(json.dumps({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "items": [], "status": "interrupted"}}}), flush=True)
"""


async def _seed_run(
    agent_run_id: str = "chat-socket-1",
    *,
    run_kind: str = AgentRun.Kind.CHAT,
) -> AgentRun:
    run = await AgentRun.objects.acreate(
        id=agent_run_id,
        issue_id=TASK_ID,
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        lifecycle_state="working",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=run_kind,
        cwd="/work/ticketry",
    )
    if run_kind == AgentRun.Kind.CHAT:
        await AgentChatSession.objects.acreate(
            run=run,
            provider_thread_id="thread-1",
            status=AgentChatSession.Status.READY,
        )
    return run


def _socket_url(
    agent_run_id: str,
    *,
    cursor: int | None = None,
    api_key: str | None = None,
) -> str:
    query: dict[str, str | int] = {"agent_run_id": agent_run_id}
    if cursor is not None:
        query["cursor"] = cursor
    if api_key is not None:
        query["api_key"] = api_key
    return f"/ws/chat?{urlencode(query)}"


@override_settings(
    WORKTRACKER_DISABLE_AUTH=False,
    WORKTRACKER_API_TOKEN="chat-secret",
)
async def test_chat_socket_requires_the_desktop_api_key() -> None:
    await _seed_run()

    missing = WebsocketCommunicator(application, _socket_url("chat-socket-1"))
    assert await missing.connect() == (False, 4401)

    invalid = WebsocketCommunicator(
        application,
        _socket_url("chat-socket-1", api_key="wrong"),
    )
    assert await invalid.connect() == (False, 4401)

    authorized = WebsocketCommunicator(
        application,
        _socket_url("chat-socket-1", api_key="chat-secret"),
    )
    assert (await authorized.connect())[0]
    await authorized.disconnect()


@pytest.mark.parametrize(
    ("agent_run_id", "seed_kind", "close_code"),
    [
        ("missing-chat", None, 4404),
        ("terminal-socket-1", AgentRun.Kind.TERMINAL, 4404),
    ],
)
async def test_chat_socket_only_authorizes_existing_chat_runs(
    agent_run_id: str,
    seed_kind: str | None,
    close_code: int,
) -> None:
    if seed_kind is not None:
        await _seed_run(agent_run_id, run_kind=seed_kind)

    socket = WebsocketCommunicator(application, _socket_url(agent_run_id))

    assert await socket.connect() == (False, close_code)


@pytest.mark.parametrize("cursor", ("", "not-a-number", "-1", "1"))
async def test_chat_socket_rejects_invalid_or_impossible_cursors(cursor: str) -> None:
    await _seed_run()
    socket = WebsocketCommunicator(
        application,
        f"/ws/chat?{urlencode({'agent_run_id': 'chat-socket-1', 'cursor': cursor})}",
    )

    assert await socket.connect() == (False, 4400)


async def test_chat_socket_starts_with_an_ordered_durable_snapshot() -> None:
    await _seed_run()
    await sync_to_async(append_event, thread_sensitive=True)(
        agent_run_id="chat-socket-1",
        event_type="thread.message-sent",
        payload={"role": "user", "text": "Inspect the code"},
    )
    await sync_to_async(append_event, thread_sensitive=True)(
        agent_run_id="chat-socket-1",
        event_type="thread.message-assistant-delta",
        payload={"delta": "Looking now."},
    )

    socket = WebsocketCommunicator(application, _socket_url("chat-socket-1"))
    assert (await socket.connect())[0]

    snapshot = await socket.receive_json_from()
    assert snapshot["v"] == 1
    assert snapshot["type"] == "snapshot"
    assert snapshot["agent_run_id"] == "chat-socket-1"
    assert snapshot["run"] == {
        "agent_run_id": "chat-socket-1",
        "project_id": PROJECT_ID,
        "module_id": MODULE_ID,
        "task_id": TASK_ID,
        "agent": "codex",
        "run_kind": "chat",
        "scope": "task",
        "status": "running",
        "state": "working",
        "started_at": "2026-08-08T00:00:00+00:00",
        "ended_at": None,
        "cwd": "/work/ticketry",
    }
    assert snapshot["session"]["provider_thread_id"] == "thread-1"
    assert snapshot["session"]["status"] == "ready"
    assert snapshot["session"]["active_turn_id"] is None
    assert [event["sequence"] for event in snapshot["events"]] == [1, 2]
    assert [event["event_type"] for event in snapshot["events"]] == [
        "thread.message-sent",
        "thread.message-assistant-delta",
    ]
    assert snapshot["cursor"] == 2
    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "ready",
        "agent_run_id": "chat-socket-1",
        "cursor": 2,
    }
    await socket.disconnect()


async def test_reconnect_replays_only_the_tail_then_streams_commits_in_order() -> None:
    await _seed_run()
    for index in range(1, 4):
        await sync_to_async(append_event, thread_sensitive=True)(
            agent_run_id="chat-socket-1",
            event_type="thread.message-assistant-delta",
            payload={"delta": str(index)},
        )

    socket = WebsocketCommunicator(
        application,
        _socket_url("chat-socket-1", cursor=1),
    )
    assert (await socket.connect())[0]
    snapshot = await socket.receive_json_from()
    assert [event["sequence"] for event in snapshot["events"]] == [2, 3]
    assert snapshot["cursor"] == 3
    assert (await socket.receive_json_from())["type"] == "ready"

    for index in range(4, 7):
        await sync_to_async(append_event, thread_sensitive=True)(
            agent_run_id="chat-socket-1",
            event_type="thread.message-assistant-delta",
            payload={"delta": str(index)},
        )

    deltas = [await socket.receive_json_from() for _ in range(3)]
    assert [frame["type"] for frame in deltas] == ["event", "event", "event"]
    assert [frame["event"]["sequence"] for frame in deltas] == [4, 5, 6]
    assert [frame["event"]["payload"]["delta"] for frame in deltas] == [
        "4",
        "5",
        "6",
    ]
    await socket.disconnect()


async def test_snapshot_to_live_handoff_delivers_each_sequence_exactly_once() -> None:
    await _seed_run()
    socket = WebsocketCommunicator(application, _socket_url("chat-socket-1"))

    async def append_during_connect() -> None:
        for sequence in range(1, 25):
            await sync_to_async(append_event, thread_sensitive=True)(
                agent_run_id="chat-socket-1",
                event_type="thread.message-assistant-delta",
                payload={"delta": str(sequence)},
            )
            await asyncio.sleep(0)

    connect = asyncio.create_task(socket.connect())
    writer = asyncio.create_task(append_during_connect())
    assert (await connect)[0]
    snapshot = await socket.receive_json_from()
    assert (await socket.receive_json_from())["type"] == "ready"
    await writer

    observed = [event["sequence"] for event in snapshot["events"]]
    while len(observed) < 24:
        frame = await socket.receive_json_from(timeout=3)
        assert frame["type"] == "event"
        observed.append(frame["event"]["sequence"])

    assert observed == list(range(1, 25))
    assert await socket.receive_nothing(timeout=0.1)
    await socket.disconnect()


async def test_rolled_back_event_is_neither_live_nor_replayable() -> None:
    await _seed_run()
    socket = WebsocketCommunicator(application, _socket_url("chat-socket-1"))
    assert (await socket.connect())[0]
    assert (await socket.receive_json_from())["cursor"] == 0
    await socket.receive_json_from()  # ready

    def append_then_rollback() -> None:
        try:
            with transaction.atomic():
                append_event(
                    agent_run_id="chat-socket-1",
                    event_type="thread.message-sent",
                    payload={"text": "must roll back"},
                )
                raise RuntimeError("roll back")
        except RuntimeError:
            pass

    await sync_to_async(append_then_rollback, thread_sensitive=True)()

    assert await socket.receive_nothing(timeout=0.1)
    await socket.disconnect()
    replay = WebsocketCommunicator(application, _socket_url("chat-socket-1"))
    assert (await replay.connect())[0]
    snapshot = await replay.receive_json_from()
    assert snapshot["events"] == []
    assert snapshot["cursor"] == 0
    await replay.disconnect()


async def _receive_event(socket, event_type: str) -> dict:
    seen = []
    while True:
        try:
            frame = await socket.receive_json_from(timeout=5)
        except asyncio.TimeoutError as exc:
            raise AssertionError(
                f"did not receive {event_type}; saw {seen}"
            ) from exc
        seen.append(frame)
        if frame["type"] == "event" and frame["event"]["event_type"] == event_type:
            return frame["event"]


async def _receive_ack(socket, command_id: str) -> dict:
    while True:
        frame = await socket.receive_json_from(timeout=5)
        if frame["type"] in {"ack", "error"} and frame.get("command_id") == command_id:
            return frame


async def test_checked_commands_drive_the_persistent_runtime_and_ack_each_request(
    tmp_path,
) -> None:
    await _seed_run()
    runtime = CodexChatRuntime(
        agent_run_id="chat-socket-1",
        argv=[sys.executable, "-u", "-c", COMMAND_PEER],
        cwd=str(tmp_path),
        version="test",
    )
    await runtime_supervisor.call(lambda: runtime_registry.add(runtime))
    socket = WebsocketCommunicator(application, _socket_url("chat-socket-1"))
    try:
        assert (await socket.connect())[0]
        await socket.receive_json_from()  # snapshot
        await socket.receive_json_from()  # ready

        await socket.send_json_to(
            {
                "v": 1,
                "type": "start_turn",
                "command_id": "command-turn",
                "prompt": "Inspect the code",
            }
        )
        assert await socket.receive_json_from(timeout=3) == {
            "v": 1,
            "type": "ack",
            "agent_run_id": "chat-socket-1",
            "command_id": "command-turn",
            "command": "start_turn",
            "result": {"turn_id": "turn-1"},
        }
        approval = await _receive_event(
            socket,
            "thread.approval-response-requested",
        )

        await socket.send_json_to(
            {
                "v": 1,
                "type": "respond_approval",
                "command_id": "command-approval",
                "request_id": approval["payload"]["requestId"],
                "decision": "accept",
            }
        )
        assert (await _receive_ack(socket, "command-approval"))["type"] == "ack"
        user_input = await _receive_event(
            socket,
            "thread.user-input-response-requested",
        )

        await socket.send_json_to(
            {
                "v": 1,
                "type": "respond_user_input",
                "command_id": "command-input",
                "request_id": user_input["payload"]["requestId"],
                "answers": {"scope": ["backend"]},
            }
        )
        assert (await _receive_ack(socket, "command-input"))["type"] == "ack"

        await socket.send_json_to(
            {"v": 1, "type": "interrupt", "command_id": "command-interrupt"}
        )
        assert await _receive_ack(socket, "command-interrupt") == {
            "v": 1,
            "type": "ack",
            "agent_run_id": "chat-socket-1",
            "command_id": "command-interrupt",
            "command": "interrupt",
            "result": {"interrupted": True},
        }

        await socket.send_json_to(
            {"v": 1, "type": "stop", "command_id": "command-stop"}
        )
        stop_ack = await _receive_ack(socket, "command-stop")
        assert stop_ack == {
            "v": 1,
            "type": "ack",
            "agent_run_id": "chat-socket-1",
            "command_id": "command-stop",
            "command": "stop",
            "result": {"stopped": True, "stopped_live_process": True},
        }
    finally:
        if not socket.future.done():
            await socket.disconnect()
        await runtime_supervisor.call(
            lambda: runtime_registry.remove("chat-socket-1")
        )


async def test_invalid_command_gets_a_correlated_checked_error() -> None:
    await _seed_run()
    socket = WebsocketCommunicator(application, _socket_url("chat-socket-1"))
    assert (await socket.connect())[0]
    await socket.receive_json_from()
    await socket.receive_json_from()

    await socket.send_json_to(
        {
            "v": 1,
            "type": "start_turn",
            "command_id": "bad-turn",
            "prompt": "   ",
            "provider_frame": {"method": "turn/start"},
        }
    )

    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "error",
        "agent_run_id": "chat-socket-1",
        "code": "invalid_command",
        "message": "Invalid Chat command frame.",
        "command_id": "bad-turn",
        "retryable": False,
    }
    await socket.disconnect()


async def test_runtime_rejection_is_a_correlated_error_without_closing_replay() -> None:
    await _seed_run()
    socket = WebsocketCommunicator(application, _socket_url("chat-socket-1"))
    assert (await socket.connect())[0]
    await socket.receive_json_from()
    await socket.receive_json_from()

    await socket.send_json_to(
        {"v": 1, "type": "interrupt", "command_id": "missing-runtime"}
    )

    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "error",
        "agent_run_id": "chat-socket-1",
        "code": "chat_runtime_unavailable",
        "message": "chat_runtime_unavailable",
        "command_id": "missing-runtime",
        "retryable": False,
    }
    assert await socket.receive_nothing(timeout=0.1)
    await socket.disconnect()


async def test_ambiguous_turn_failure_is_correlated_and_non_retryable(
    monkeypatch,
) -> None:
    run_id = "chat-socket-delivery-unknown"
    await _seed_run(run_id)

    async def fail_unknown(*_args, **_kwargs):
        raise TurnStartError("provider response was lost", delivery_unknown=True)

    monkeypatch.setattr(consumer.chat_session, "send_turn", fail_unknown)
    socket = WebsocketCommunicator(application, _socket_url(run_id))
    assert (await socket.connect())[0]
    await socket.receive_json_from()
    await socket.receive_json_from()
    await socket.send_json_to(
        {
            "v": 1,
            "type": "start_turn",
            "command_id": "unknown-turn",
            "prompt": "Possibly accepted",
        }
    )

    assert await socket.receive_json_from() == {
        "v": 1,
        "type": "error",
        "agent_run_id": run_id,
        "code": "turn_delivery_unknown",
        "message": "provider response was lost",
        "command_id": "unknown-turn",
        "retryable": False,
    }
    await socket.disconnect()
