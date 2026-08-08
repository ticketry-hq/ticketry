import asyncio
import sys
from types import SimpleNamespace

import pytest
from asgiref.sync import sync_to_async

from apps.runs.chat.codex_runtime import (
    BACKEND_ONLY_ENVIRONMENT_KEYS,
    CodexChatRuntime,
    CodexChatRuntimeRegistry,
    RequestKindMismatchError,
    TurnAlreadyActiveError,
    TurnStartError,
    app_server_environment,
    initialize_params,
    normalize_notification,
    thread_start_params,
    turn_start_params,
)
from apps.runs.chat.events import replay_events
from apps.runs.chat.jsonrpc import JsonRpcContainmentError, JsonRpcServerRequestError
from apps.runs.models import AgentChatSession, AgentRun
from worktracker.tests.factories import fixture_issue_id


PEER = r"""
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
        result = {"thread": {"id": "provider-thread-1"}, "cwd": "/tmp/project", "model": "gpt-test"}
        print(json.dumps({"id": frame["id"], "result": result}), flush=True)
    elif method == "turn/start":
        print(json.dumps({"id": frame["id"], "result": {"turn": {"id": "turn-1"}}}), flush=True)
        print(json.dumps({"method": "turn/started", "params": {"threadId": "provider-thread-1", "turn": {"id": "turn-1"}}}), flush=True)
        print(json.dumps({"method": "item/agentMessage/delta", "params": {"threadId": "provider-thread-1", "turnId": "turn-1", "itemId": "message-1", "delta": "Hello"}}), flush=True)
        print(json.dumps({"method": "turn/completed", "params": {"threadId": "provider-thread-1", "turn": {"id": "turn-1", "status": "completed"}}}), flush=True)
    elif method == "thread/read":
        print(json.dumps({"id": frame["id"], "result": {"thread": {"id": "provider-thread-1", "turns": []}}}), flush=True)
"""


RETRY_PEER = r"""
import json
import sys

turn_attempt = 0
for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if "id" not in frame:
        continue
    if method == "initialize":
        print(json.dumps({"id": frame["id"], "result": {}}), flush=True)
    elif method == "thread/start":
        print(json.dumps({"id": frame["id"], "result": {"thread": {"id": "root-thread"}}}), flush=True)
    elif method == "turn/start":
        turn_attempt += 1
        if turn_attempt == 1:
            print(json.dumps({"id": frame["id"], "error": {"code": -32000, "message": "token=private-value launch failed"}}), flush=True)
        else:
            print(json.dumps({"id": frame["id"], "result": {"turn": {"id": "retry-turn"}}}), flush=True)
"""


CLEAN_EXIT_PEER = r"""
import json
import sys

for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if "id" not in frame:
        continue
    if method == "initialize":
        print(json.dumps({"id": frame["id"], "result": {}}), flush=True)
    elif method == "thread/start":
        print(json.dumps({"id": frame["id"], "result": {"thread": {"id": "clean-exit-thread"}}}), flush=True)
        sys.exit(0)
"""


async def _seed_chat_run(run_id: str) -> AgentRun:
    run = await AgentRun.objects.acreate(
        id=run_id,
        issue_id=fixture_issue_id(
            project_id="proj-1",
            module_id="mod-1",
            task_id="task-1",
        ),
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        lifecycle_state="working",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(run=run)
    return run


def test_codex_params_retain_t3_protocol_shape_and_ticketry_defaults():
    assert initialize_params("1.2.3")["capabilities"] == {"experimentalApi": True}
    assert thread_start_params(cwd="/work") == {
        "cwd": "/work",
        "approvalPolicy": "never",
        "sandbox": "danger-full-access",
        "approvalsReviewer": "auto_review",
    }
    assert turn_start_params(
        thread_id="thread-1",
        prompt="Inspect",
        model="gpt-test",
        reasoning="ultra",
    ) == {
        "threadId": "thread-1",
        "input": [{"type": "text", "text": "Inspect"}],
        "approvalPolicy": "never",
        "approvalsReviewer": "auto_review",
        "sandboxPolicy": {"type": "dangerFullAccess"},
        "model": "gpt-test",
        "effort": "ultra",
    }


def test_app_server_environment_strips_backend_authority_but_keeps_provider_env(
    monkeypatch,
):
    for key in BACKEND_ONLY_ENVIRONMENT_KEYS:
        monkeypatch.setenv(key, f"master-{key.lower()}")
    monkeypatch.setenv("OPENAI_API_KEY", "provider-credential")

    environment = app_server_environment(
        {
            "WORKTRACKER_API_TOKEN": "attempted-override",
            "CHAT_RUN_ENV": "run-specific",
        }
    )

    assert BACKEND_ONLY_ENVIRONMENT_KEYS.isdisjoint(environment)
    assert environment["OPENAI_API_KEY"] == "provider-credential"
    assert environment["CHAT_RUN_ENV"] == "run-specific"


def test_codex_notifications_normalize_without_discarding_native_payload():
    event_type, payload = normalize_notification(
        "item/agentMessage/delta",
        {"turnId": "turn-1", "delta": "Hi"},
    )

    assert event_type == "thread.message-assistant-delta"
    assert payload == {
        "providerMethod": "item/agentMessage/delta",
        "turnId": "turn-1",
        "delta": "Hi",
    }


@pytest.mark.asyncio
async def test_runtime_rejects_unsupported_and_uncorrelated_server_requests(tmp_path):
    runtime = CodexChatRuntime(
        agent_run_id="typed-request-runtime",
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    runtime.provider_thread_id = "root-thread"
    runtime.active_turn_id = "root-turn"

    with pytest.raises(JsonRpcServerRequestError) as unsupported:
        await runtime._on_request(
            "unsupported-provider-request",
            "item/permissions/requestApproval",
            {"threadId": "root-thread", "turnId": "root-turn"},
        )
    assert unsupported.value.code == -32601

    with pytest.raises(JsonRpcServerRequestError) as child_thread:
        await runtime._on_request(
            "child-provider-request",
            "item/commandExecution/requestApproval",
            {"threadId": "child-thread", "turnId": "child-turn"},
        )
    assert child_thread.value.code == -32602


@pytest.mark.parametrize(
    ("method", "event_type"),
    [
        ("turn/plan/updated", "thread.proposed-plan-upserted"),
        ("turn/diff/updated", "thread.turn-diff-updated"),
        ("item/plan/delta", "thread.proposed-plan-delta"),
        ("item/reasoning/summaryTextDelta", "thread.reasoning-summary-delta"),
        ("item/commandExecution/outputDelta", "thread.command-output-delta"),
        ("item/fileChange/patchUpdated", "thread.file-change-patch-updated"),
        ("item/mcpToolCall/progress", "thread.tool-progress"),
    ],
)
def test_codex_notifications_cover_t3_rich_timeline_events(
    method: str,
    event_type: str,
):
    normalized_type, payload = normalize_notification(method, {"value": "kept"})

    assert normalized_type == event_type
    assert payload == {"providerMethod": method, "value": "kept"}


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_thread_started_notification_atomically_persists_resume_identity(
    tmp_path,
):
    run = await _seed_chat_run("chat-early-thread-started")
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )

    await runtime._on_notification(
        "thread/started",
        {"thread": {"id": "early-provider-thread"}},
    )

    session = await AgentChatSession.objects.aget(run=run)
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    assert runtime.provider_thread_id == "early-provider-thread"
    assert session.provider_thread_id == "early-provider-thread"
    assert events[-1].event_type == "thread.session-set"
    assert events[-1].payload["thread"]["id"] == "early-provider-thread"


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_runtime_opens_thread_streams_a_turn_and_persists_replay(tmp_path):
    run = await AgentRun.objects.acreate(
        id="chat-runtime-1",
        issue_id=fixture_issue_id(
            project_id="proj-1",
            module_id="mod-1",
            task_id="task-1",
        ),
        agent="codex",
        status="running",
        started_at="2026-08-08T00:00:00+00:00",
        lifecycle_state="starting",
        lifecycle_updated_at="2026-08-08T00:00:00+00:00",
        scope="task",
        run_kind=AgentRun.Kind.CHAT,
    )
    await AgentChatSession.objects.acreate(run=run)
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
        model="gpt-test",
        reasoning="ultra",
    )

    try:
        await runtime.start(initial_prompt="Inspect the code")
        await runtime.read_thread()

        session = await AgentChatSession.objects.aget(run=run)
        events = await sync_to_async(replay_events, thread_sensitive=True)(
            agent_run_id=run.id
        )
        assert session.provider_thread_id == "provider-thread-1"
        assert session.status == AgentChatSession.Status.READY
        await run.arefresh_from_db()
        assert run.lifecycle_state == "turn_complete"
        assert run.run_kind == AgentRun.Kind.CHAT
        assert [event.event_type for event in events] == [
            "thread.session-set",
            "thread.message-sent",
            "thread.turn-started",
            "thread.message-assistant-delta",
            "thread.turn-completed",
        ]
        assert events[3].payload["delta"] == "Hello"
    finally:
        await runtime.close()
    await run.arefresh_from_db()
    assert run.status == "exited"
    assert run.lifecycle_state == "exited"
    assert run.ended_at is not None


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_root_turn_correlation_terminal_statuses_and_retryable_errors(tmp_path):
    run = await _seed_chat_run("chat-correlation")
    await AgentChatSession.objects.filter(run=run).aupdate(
        provider_thread_id="root-thread",
        status=AgentChatSession.Status.RUNNING,
        active_turn_id="root-turn",
    )
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    runtime.provider_thread_id = "root-thread"
    runtime.active_turn_id = "root-turn"

    await runtime._on_notification(
        "turn/completed",
        {
            "threadId": "child-thread",
            "turn": {"id": "child-turn", "status": "completed"},
        },
    )
    session = await AgentChatSession.objects.aget(run=run)
    assert session.active_turn_id == "root-turn"
    assert session.status == AgentChatSession.Status.RUNNING

    await runtime._on_notification(
        "turn/completed",
        {
            "threadId": "root-thread",
            "turn": {"id": "root-turn", "status": "interrupted"},
        },
    )
    session = await AgentChatSession.objects.aget(run=run)
    assert session.active_turn_id is None
    assert session.status == AgentChatSession.Status.INTERRUPTED

    runtime.active_turn_id = "failed-turn"
    await AgentChatSession.objects.filter(run=run).aupdate(
        status=AgentChatSession.Status.RUNNING,
        active_turn_id="failed-turn",
    )
    await runtime._on_notification(
        "turn/completed",
        {
            "threadId": "root-thread",
            "turn": {
                "id": "failed-turn",
                "status": "failed",
                "error": {"message": "token=provider-secret failed"},
            },
        },
    )
    session = await AgentChatSession.objects.aget(run=run)
    assert session.active_turn_id is None
    assert session.status == AgentChatSession.Status.ERROR
    assert "provider-secret" not in (session.last_error or "")

    runtime.active_turn_id = "retry-turn"
    await AgentChatSession.objects.filter(run=run).aupdate(
        status=AgentChatSession.Status.RUNNING,
        active_turn_id="retry-turn",
        last_error=None,
    )
    await runtime._on_notification(
        "error",
        {
            "threadId": "root-thread",
            "turnId": "retry-turn",
            "willRetry": True,
            "error": {"message": "temporary provider failure"},
        },
    )
    session = await AgentChatSession.objects.aget(run=run)
    assert session.status == AgentChatSession.Status.RUNNING
    assert session.last_error is None

    await runtime._on_notification(
        "error",
        {
            "threadId": "root-thread",
            "turnId": "retry-turn",
            "willRetry": False,
            "error": {
                "message": "provider failed",
                "data": {
                    "authorization": "Bearer private-auth",
                    "api_key": "private-key",
                    "nested": {"refreshToken": "private-refresh"},
                    "debug": "Authorization: Bearer private-debug",
                    "context": "token=private-context",
                    "retryable": False,
                },
            },
        },
    )
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    durable_error = events[-1]
    assert durable_error.event_type == "thread.error"
    assert durable_error.payload["error"]["data"] == {
        "authorization": "[REDACTED]",
        "api_key": "[REDACTED]",
        "nested": {"refreshToken": "[REDACTED]"},
        "debug": "Authorization: Bearer [REDACTED]",
        "context": "token=[REDACTED]",
        "retryable": False,
    }
    assert "private-" not in str(durable_error.payload)


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_pending_requests_enforce_kind_dedupe_and_secret_audit(tmp_path):
    run = await _seed_chat_run("chat-pending-requests")
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    runtime.provider_thread_id = "root-thread"
    runtime.active_turn_id = "turn-1"

    approval_operation = runtime._on_request(
        "provider-approval-1",
        "item/commandExecution/requestApproval",
        {
            "threadId": "root-thread",
            "turnId": "turn-1",
            "itemId": "command-1",
        },
    )
    approval_task = asyncio.create_task(approval_operation.result)
    input_operation = runtime._on_request(
        "provider-input-1",
        "item/tool/requestUserInput",
        {
            "threadId": "root-thread",
            "turnId": "turn-1",
            "itemId": "tool-1",
            "questions": [
                {
                    "id": "password",
                    "header": "Password",
                    "question": "Enter it",
                    "isSecret": True,
                }
            ],
        },
    )
    input_task = asyncio.create_task(input_operation.result)
    await asyncio.gather(approval_operation.ready, input_operation.ready)
    for _ in range(100):
        if len(runtime._pending_requests) == 2:
            break
        await asyncio.sleep(0.01)
    assert len(runtime._pending_requests) == 2
    assert set(runtime._pending_requests) == {
        "provider-approval-1",
        "provider-input-1",
    }
    approval_id = next(
        request_id
        for request_id, pending in runtime._pending_requests.items()
        if pending.method == "item/commandExecution/requestApproval"
    )
    input_id = next(
        request_id
        for request_id, pending in runtime._pending_requests.items()
        if pending.method == "item/tool/requestUserInput"
    )

    with pytest.raises(RequestKindMismatchError):
        await runtime.respond_to_approval(input_id, "accept")

    duplicate_results = await asyncio.gather(
        runtime.respond_to_approval(approval_id, "accept"),
        runtime.respond_to_approval(approval_id, "accept"),
        return_exceptions=True,
    )
    assert sum(result is None for result in duplicate_results) == 1
    assert sum(isinstance(result, KeyError) for result in duplicate_results) == 1
    assert await approval_task == {"decision": "accept"}
    await run.arefresh_from_db()
    assert run.lifecycle_state == "needs_input"

    await runtime.respond_to_user_input(
        input_id,
        {"password": ["never-persist-this"]},
    )
    assert await input_task == {
        "answers": {"password": {"answers": ["never-persist-this"]}}
    }
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    response_event = next(
        event
        for event in events
        if event.event_type == "thread.user-input-responded"
    )
    assert response_event.payload["answers"] == {"password": ["[REDACTED]"]}
    assert "never-persist-this" not in str(response_event.payload)


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_provider_resolution_uses_the_same_canonical_request_id(tmp_path):
    run = await _seed_chat_run("chat-provider-request-resolved")
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    runtime.provider_thread_id = "root-thread"
    runtime.active_turn_id = "turn-1"

    request_operation = runtime._on_request(
        73,
        "item/commandExecution/requestApproval",
        {
            "threadId": "root-thread",
            "turnId": "turn-1",
            "itemId": "command-1",
        },
    )
    request_task = asyncio.create_task(request_operation.result)
    await request_operation.ready
    assert "73" in runtime._pending_requests

    await runtime._on_notification(
        "serverRequest/resolved",
        {
            "threadId": "root-thread",
            "turnId": "turn-1",
            "requestId": 73,
        },
    )
    with pytest.raises(asyncio.CancelledError):
        await request_task
    assert runtime._pending_requests == {}

    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    request_event = next(
        event
        for event in events
        if event.event_type == "thread.approval-response-requested"
    )
    resolved_event = next(
        event for event in events if event.event_type == "thread.request-resolved"
    )
    assert request_event.payload["requestId"] == "73"
    assert resolved_event.payload["requestId"] == "73"
    assert request_event.sequence < resolved_event.sequence


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_process_close_durably_resolves_pending_provider_requests(tmp_path):
    run = await _seed_chat_run("chat-request-close")
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    runtime.provider_thread_id = "root-thread"
    runtime.active_turn_id = "turn-1"

    request_operation = runtime._on_request(
        "request-on-close",
        "item/commandExecution/requestApproval",
        {
            "threadId": "root-thread",
            "turnId": "turn-1",
            "itemId": "command-1",
        },
    )
    request_task = asyncio.create_task(request_operation.result)
    await request_operation.ready
    assert runtime._pending_requests["request-on-close"].announced

    await runtime.close(resumable=True)
    with pytest.raises(asyncio.CancelledError):
        await request_task

    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    resolved_event = next(
        event for event in events if event.event_type == "thread.request-resolved"
    )
    assert resolved_event.payload == {
        "requestId": "request-on-close",
        "requestKind": "item/commandExecution/requestApproval",
        "reason": "process_ended",
        "cancelled": True,
    }


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_failed_turn_start_is_audited_and_retry_clears_stale_errors(tmp_path):
    run = await _seed_chat_run("chat-turn-retry")
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", RETRY_PEER],
        cwd=str(tmp_path),
        version="test",
    )
    try:
        await runtime.start()
        with pytest.raises(TurnStartError):
            await runtime.send_turn("First attempt")

        session = await AgentChatSession.objects.aget(run=run)
        await run.arefresh_from_db()
        assert session.status == AgentChatSession.Status.ERROR
        assert "private-value" not in (session.last_error or "")
        assert run.error == session.last_error
        events = await sync_to_async(replay_events, thread_sensitive=True)(
            agent_run_id=run.id
        )
        assert [event.event_type for event in events][-2:] == [
            "thread.message-sent",
            "thread.message-failed",
        ]
        assert "deliveryUnknown" not in events[-1].payload
        assert "retryable" not in events[-1].payload

        assert await runtime.send_turn(
            "Retry",
            client_message_id="ws-command-retry",
        ) == "retry-turn"
        session = await AgentChatSession.objects.aget(run=run)
        await run.arefresh_from_db()
        assert session.status == AgentChatSession.Status.RUNNING
        assert session.last_error is None
        assert run.error is None
        events = await sync_to_async(replay_events, thread_sensitive=True)(
            agent_run_id=run.id
        )
        assert next(
            event.payload["id"]
            for event in reversed(events)
            if event.event_type == "thread.message-sent"
        ) == "ws-command-retry"
    finally:
        await runtime.close()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_cancelled_turn_start_is_durably_delivery_unknown(tmp_path):
    run = await _seed_chat_run("chat-cancelled-turn")
    request_written = asyncio.Event()

    class HangingClient:
        async def request(self, method, _params):
            assert method == "turn/start"
            request_written.set()
            await asyncio.Future()

    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    runtime.provider_thread_id = "root-thread"
    runtime._client = HangingClient()

    sending = asyncio.create_task(
        runtime.send_turn(
            "Possibly accepted work",
            client_message_id="cancelled-command",
        )
    )
    await request_written.wait()
    sending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await sending

    session = await AgentChatSession.objects.aget(run=run)
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    failure = events[-1]
    assert failure.event_type == "thread.message-failed"
    assert failure.payload == {
        "id": "cancelled-command",
        "role": "user",
        "phase": "turn/start",
        "error": "turn/start was cancelled",
        "deliveryUnknown": True,
        "retryable": False,
    }
    assert session.status == AgentChatSession.Status.ERROR
    assert session.active_turn_id is None


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_runtime_serializes_concurrent_turn_starts(tmp_path):
    run = await _seed_chat_run("chat-concurrent-turns")
    request_started = asyncio.Event()
    release_request = asyncio.Event()

    class GateClient:
        async def request(self, method, _params):
            assert method == "turn/start"
            request_started.set()
            await release_request.wait()
            return {"turn": {"id": "only-turn"}}

    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    runtime.provider_thread_id = "root-thread"
    runtime._client = GateClient()

    first = asyncio.create_task(runtime.send_turn("First"))
    await request_started.wait()
    second = asyncio.create_task(runtime.send_turn("Second"))
    await asyncio.sleep(0)
    release_request.set()

    assert await first == "only-turn"
    with pytest.raises(TurnAlreadyActiveError):
        await second


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_registry_shutdown_leaves_provider_thread_resumable(tmp_path):
    run = await _seed_chat_run("chat-shutdown-resumable")
    registry = CodexChatRuntimeRegistry()
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )
    await registry.add(runtime)

    await registry.close_all()

    session = await AgentChatSession.objects.aget(run=run)
    await run.arefresh_from_db()
    assert session.status == AgentChatSession.Status.INTERRUPTED
    assert session.provider_thread_id == "provider-thread-1"
    assert session.active_turn_id is None
    assert run.status == "interrupted"
    assert run.lifecycle_state == "quiet"
    assert run.ended_at is None


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_watcher_containment_failure_retains_registry_owner_for_stop_retry(
    tmp_path,
):
    run = await _seed_chat_run("chat-watcher-containment-retry")
    registry = CodexChatRuntimeRegistry()
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", PEER],
        cwd=str(tmp_path),
        version="test",
    )

    class FlakyClient:
        close_calls = 0

        async def wait(self):
            raise JsonRpcContainmentError("tree still alive")

        async def close(self):
            self.close_calls += 1

    client = FlakyClient()
    runtime._client = client
    runtime._on_exit = registry._discard
    registry._runtimes[run.id] = runtime

    await runtime._watch_process()

    assert registry.get(run.id) is runtime
    assert runtime._on_exit == registry._discard

    await registry.remove(run.id)
    with pytest.raises(KeyError):
        registry.get(run.id)
    assert client.close_calls == 1


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_unrequested_clean_provider_exit_is_resumable(tmp_path):
    run = await _seed_chat_run("chat-clean-exit")
    runtime = CodexChatRuntime(
        agent_run_id=run.id,
        argv=[sys.executable, "-u", "-c", CLEAN_EXIT_PEER],
        cwd=str(tmp_path),
        version="test",
    )

    await runtime.start()
    runtime.active_turn_id = "orphaned-clean-turn"
    assert runtime._watch_task is not None
    await runtime._watch_task

    session = await AgentChatSession.objects.aget(run=run)
    await run.arefresh_from_db()
    assert session.status == AgentChatSession.Status.INTERRUPTED
    assert session.provider_thread_id == "clean-exit-thread"
    assert run.status == "interrupted"
    assert run.ended_at is None
    assert runtime.active_turn_id is None
    events = await sync_to_async(replay_events, thread_sensitive=True)(
        agent_run_id=run.id
    )
    assert events[-1].event_type == "thread.session-interrupted"
    assert events[-1].payload["activeTurnId"] == "orphaned-clean-turn"


@pytest.mark.asyncio
async def test_registry_close_all_isolates_one_runtime_failure(monkeypatch):
    closed = []
    cleaned = []

    class FakeRuntime:
        def __init__(self, run_id, *, fail=False):
            self.agent_run_id = run_id
            self.fail = fail
            self._on_exit = None

        async def close(self, *, resumable=False):
            assert resumable is True
            if self.fail:
                raise RuntimeError("close failed")
            closed.append(self.agent_run_id)

    registry = CodexChatRuntimeRegistry()
    good = FakeRuntime("good-runtime")
    bad = FakeRuntime("bad-runtime", fail=True)
    registry._runtimes = {
        good.agent_run_id: good,
        bad.agent_run_id: bad,
    }

    async def fake_cleanup(runtime):
        cleaned.append(runtime.agent_run_id)

    monkeypatch.setattr(registry, "_cleanup_runtime", fake_cleanup)

    with pytest.raises(RuntimeError, match="Failed to contain 1 Chat runtime"):
        await registry.close_all()

    assert closed == ["good-runtime"]
    assert cleaned == ["good-runtime"]
    assert set(registry._runtimes) == {"bad-runtime"}
    assert bad._on_exit == registry._discard

    bad.fail = False
    await registry.close_all()
    assert closed == ["good-runtime", "bad-runtime"]
    assert cleaned == ["good-runtime", "bad-runtime"]
    assert registry._runtimes == {}


@pytest.mark.asyncio
async def test_registry_remove_retains_owner_after_failed_close_then_retries():
    class FlakyRuntime:
        agent_run_id = "flaky-remove-runtime"

        def __init__(self):
            self._on_exit = None
            self.close_attempts = 0

        async def close(self, *, resumable=False):
            assert resumable is False
            self.close_attempts += 1
            if self.close_attempts == 1:
                raise RuntimeError("transient containment failure")

    registry = CodexChatRuntimeRegistry()
    runtime = FlakyRuntime()
    runtime._on_exit = registry._discard
    registry._runtimes[runtime.agent_run_id] = runtime

    with pytest.raises(RuntimeError, match="containment failure"):
        await registry.remove(runtime.agent_run_id)

    assert registry.get(runtime.agent_run_id) is runtime
    assert runtime._on_exit == registry._discard

    await registry.remove(runtime.agent_run_id)
    with pytest.raises(KeyError):
        registry.get(runtime.agent_run_id)
    assert runtime.close_attempts == 2


@pytest.mark.asyncio
async def test_registry_remove_retains_owner_after_cancelled_close_then_retries():
    class CancelledRuntime:
        agent_run_id = "cancelled-remove-runtime"

        def __init__(self):
            self._on_exit = None
            self.close_attempts = 0

        async def close(self, *, resumable=False):
            self.close_attempts += 1
            if self.close_attempts == 1:
                raise asyncio.CancelledError

    registry = CodexChatRuntimeRegistry()
    runtime = CancelledRuntime()
    runtime._on_exit = registry._discard
    registry._runtimes[runtime.agent_run_id] = runtime

    with pytest.raises(asyncio.CancelledError):
        await registry.remove(runtime.agent_run_id)

    assert registry.get(runtime.agent_run_id) is runtime
    assert runtime._on_exit == registry._discard

    await registry.remove(runtime.agent_run_id)
    with pytest.raises(KeyError):
        registry.get(runtime.agent_run_id)
    assert runtime.close_attempts == 2


@pytest.mark.asyncio
async def test_registry_add_retains_partially_started_runtime_until_close_retry():
    class FlakyRuntime:
        agent_run_id = "flaky-add-runtime"

        def __init__(self):
            self._on_exit = None
            self.close_attempts = 0

        async def start(self, _initial_prompt=None):
            raise RuntimeError("start failed")

        async def close(self, *, resumable=False):
            self.close_attempts += 1
            if self.close_attempts == 1:
                raise RuntimeError("close failed")

    registry = CodexChatRuntimeRegistry()
    runtime = FlakyRuntime()

    with pytest.raises(RuntimeError, match="could not be contained"):
        await registry.add(runtime)

    assert registry.get(runtime.agent_run_id) is runtime
    assert runtime._on_exit == registry._discard

    await registry.remove(runtime.agent_run_id)
    with pytest.raises(KeyError):
        registry.get(runtime.agent_run_id)
    assert runtime.close_attempts == 2


@pytest.mark.asyncio
async def test_natural_runtime_exit_releases_watch_and_run_artifacts(monkeypatch):
    from apps.documents import watch as documents_watch
    from apps.terminals.agents import registry as agent_registry

    released: list[tuple[str, str]] = []
    monkeypatch.setattr(
        documents_watch,
        "stop_watch",
        lambda run_id: released.append(("watch", run_id)),
    )
    monkeypatch.setattr(
        agent_registry,
        "cleanup_temporary_artifacts_for_run",
        lambda run_id: released.append(("artifacts", run_id)),
    )
    registry = CodexChatRuntimeRegistry()
    runtime = SimpleNamespace(agent_run_id="chat-natural-exit")
    registry._runtimes[runtime.agent_run_id] = runtime

    await registry._discard(runtime)

    assert runtime.agent_run_id not in registry._runtimes
    assert released == [
        ("watch", "chat-natural-exit"),
        ("artifacts", "chat-natural-exit"),
    ]
