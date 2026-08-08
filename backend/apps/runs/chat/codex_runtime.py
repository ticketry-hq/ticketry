"""Managed Codex app-server runtime for one Ticketry Chat run.

The lifecycle and parameter mapping are adapted from ``pingdotgg/t3code``
``apps/server/src/provider/Layers/CodexSessionRuntime.ts`` and
``apps/server/src/provider/Layers/CodexProvider.ts`` at upstream revision
``45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b`` (MIT; see
``third_party/t3code/LICENSE``). Ticketry keeps process ownership in its Python
sidecar instead of importing T3's Node/Effect server runtime.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from django.db import transaction

from apps.runs.chat.events import append_event
from apps.runs.chat.database import chat_database_sync_to_async
from apps.runs.chat.jsonrpc import (
    JsonRpcContainmentError,
    JsonRpcRemoteError,
    JsonRpcServerRequestError,
    JsonRpcStdioClient,
    ServerRequestOperation,
)
from apps.runs.chat.safety import (
    REDACTED,
    sanitize_error_payload,
    sanitize_external_message,
)
from apps.runs.bus import publish_status
from apps.runs.models import AgentChatSession, AgentRun
from studio_server.contracts import AgentLifecycleFrame, RunRecord


logger = logging.getLogger(__name__)

APPROVAL_REQUEST_METHODS = frozenset(
    {
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
    }
)
USER_INPUT_REQUEST_METHOD = "item/tool/requestUserInput"
SUPPORTED_SERVER_REQUEST_METHODS = APPROVAL_REQUEST_METHODS | {
    USER_INPUT_REQUEST_METHOD
}

# The app-server and every tool it launches may inspect their environment.
# Provider credentials must remain available, but backend master credentials,
# signing material, auth bypasses, and direct database paths must never cross
# this trust boundary. The per-run MCP bearer is injected in reviewed argv
# configuration, not inherited through any of these variables.
BACKEND_ONLY_ENVIRONMENT_KEYS = frozenset(
    {
        "MUXED_ADMIN_ENABLED",
        "MUXED_DATABASE_URL",
        "MUXED_DATABASE_URL_FILE",
        "MUXED_DATA_DIR",
        "MUXED_SECRET_KEY",
        "MUXED_SIDECAR_CREDENTIAL",
        "MUXED_STATE_DB",
        "WORKTRACKER_API_TOKEN",
        "WORKTRACKER_DISABLE_AUTH",
    }
)


class TurnAlreadyActiveError(RuntimeError):
    """A second provider turn was attempted while one is still active."""


class TurnStartError(RuntimeError):
    """The provider rejected or lost a turn/start request after audit began."""

    def __init__(self, message: str, *, delivery_unknown: bool = False):
        super().__init__(message)
        self.delivery_unknown = delivery_unknown


class RequestKindMismatchError(ValueError):
    """A response command does not match its provider request kind."""


@dataclass
class PendingServerRequest:
    """One typed, provider-originated request awaiting a user decision."""

    method: str
    params: dict[str, Any]
    future: asyncio.Future[Any]
    resolving: bool = False
    announced: bool = False
    resolution_recorded: bool = False


def initialize_params(version: str) -> dict[str, Any]:
    """Return the app-server capability handshake used by the Chat client."""

    return {
        "clientInfo": {
            "name": "ticketry_desktop",
            "title": "Ticketry Desktop",
            "version": version,
        },
        "capabilities": {"experimentalApi": True},
    }


def app_server_environment(overrides: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return the provider environment without backend authority material."""

    environment = os.environ.copy()
    if overrides:
        environment.update(overrides)
    for key in BACKEND_ONLY_ENVIRONMENT_KEYS:
        environment.pop(key, None)
    return environment


def thread_start_params(
    *,
    cwd: str,
    model: str | None = None,
    service_tier: str | None = None,
) -> dict[str, Any]:
    """Build the autonomous default used by existing Ticketry Codex runs."""

    params: dict[str, Any] = {
        "cwd": cwd,
        "approvalPolicy": "never",
        "sandbox": "danger-full-access",
        "approvalsReviewer": "auto_review",
    }
    if model:
        params["model"] = model
    if service_tier:
        params["serviceTier"] = service_tier
    return params


def turn_start_params(
    *,
    thread_id: str,
    prompt: str,
    model: str | None = None,
    reasoning: str | None = None,
    service_tier: str | None = None,
) -> dict[str, Any]:
    """Build a text turn while retaining Ticketry's autonomous defaults."""

    params: dict[str, Any] = {
        "threadId": thread_id,
        "input": [{"type": "text", "text": prompt}],
        "approvalPolicy": "never",
        "approvalsReviewer": "auto_review",
        "sandboxPolicy": {"type": "dangerFullAccess"},
    }
    if model:
        params["model"] = model
    if reasoning:
        params["effort"] = reasoning
    if service_tier:
        params["serviceTier"] = service_tier
    return params


def normalize_notification(method: str, params: Any) -> tuple[str, dict[str, Any]]:
    """Map Codex-native notifications to the T3-derived Ticketry vocabulary."""

    payload = params if isinstance(params, dict) else {"value": params}
    payload = {"providerMethod": method, **payload}
    if method == "serverRequest/resolved" and payload.get("requestId") is not None:
        # JSON-RPC ids may be numbers or strings. The public Chat protocol uses
        # one string identity so request, response, and provider-resolution
        # events always project onto the same pending UI card.
        payload["requestId"] = str(payload["requestId"])
    event_type = {
        "thread/started": "thread.session-set",
        "thread/status/changed": "thread.state-changed",
        "thread/name/updated": "thread.metadata-updated",
        "thread/archived": "thread.state-changed",
        "thread/unarchived": "thread.state-changed",
        "thread/closed": "thread.state-changed",
        "thread/compacted": "thread.state-changed",
        "turn/started": "thread.turn-started",
        "turn/completed": "thread.turn-completed",
        "turn/diff/updated": "thread.turn-diff-updated",
        "turn/plan/updated": "thread.proposed-plan-upserted",
        "item/plan/delta": "thread.proposed-plan-delta",
        "item/agentMessage/delta": "thread.message-assistant-delta",
        "item/reasoning/textDelta": "thread.reasoning-delta",
        "item/reasoning/summaryTextDelta": "thread.reasoning-summary-delta",
        "item/reasoning/summaryPartAdded": "thread.reasoning-summary-part-added",
        "item/commandExecution/outputDelta": "thread.command-output-delta",
        "item/commandExecution/terminalInteraction": (
            "thread.command-terminal-interaction"
        ),
        "item/fileChange/outputDelta": "thread.file-change-output-delta",
        "item/fileChange/patchUpdated": "thread.file-change-patch-updated",
        "item/mcpToolCall/progress": "thread.tool-progress",
        "item/started": "thread.activity-started",
        "item/completed": "thread.activity-completed",
        "thread/tokenUsage/updated": "thread.token-usage-updated",
        "serverRequest/resolved": "thread.request-resolved",
        "error": "thread.error",
    }.get(method, "thread.provider-notification")
    return event_type, payload


class CodexChatRuntime:
    """One live Codex app-server process correlated to an ``AgentRun``."""

    def __init__(
        self,
        *,
        agent_run_id: str,
        argv: Sequence[str],
        cwd: str,
        version: str,
        model: str | None = None,
        reasoning: str | None = None,
        service_tier: str | None = None,
        env: Mapping[str, str] | None = None,
        resume_thread_id: str | None = None,
    ):
        self.agent_run_id = agent_run_id
        self.argv = tuple(argv)
        self.cwd = cwd
        self.version = version
        self.model = model
        self.reasoning = reasoning
        self.service_tier = service_tier
        self.env = dict(env) if env is not None else None
        self.resume_thread_id = resume_thread_id
        self.provider_thread_id: str | None = None
        self.active_turn_id: str | None = None
        self._last_terminal_turn_id: str | None = None
        self._client: JsonRpcStdioClient | None = None
        self._pending_requests: dict[str, PendingServerRequest] = {}
        self._turn_lock = asyncio.Lock()
        self._watch_task: asyncio.Task[None] | None = None
        self._on_exit: Callable[["CodexChatRuntime"], Awaitable[None]] | None = None
        self._closing = False
        self._resumable_shutdown = False

    async def start(self, initial_prompt: str | None = None) -> None:
        """Spawn, initialize, and open or resume the provider thread."""

        if self._client is not None:
            raise RuntimeError("Chat runtime is already started")
        process_env = app_server_environment(self.env)
        self._client = await JsonRpcStdioClient.start(
            self.argv,
            cwd=self.cwd,
            env=process_env,
            on_notification=self._on_notification,
            on_request=self._on_request,
        )
        await self._client.request("initialize", initialize_params(self.version))
        await self._client.notify("initialized")

        params = thread_start_params(
            cwd=self.cwd,
            model=self.model,
            service_tier=self.service_tier,
        )
        method = "thread/start"
        if self.resume_thread_id:
            method = "thread/resume"
            params = {"threadId": self.resume_thread_id, **params}
        opened = await self._client.request(method, params)
        self.provider_thread_id = str(opened["thread"]["id"])
        await self._set_session(
            status=AgentChatSession.Status.READY,
            provider_thread_id=self.provider_thread_id,
            active_turn_id=None,
            last_error=None,
        )
        await self._append(
            "thread.session-set",
            {
                "status": "ready",
                "provider": "codex",
                "providerThreadId": self.provider_thread_id,
                "cwd": opened.get("cwd", self.cwd),
                "model": opened.get("model", self.model),
            },
        )
        self._watch_task = asyncio.create_task(self._watch_process())
        if initial_prompt is not None:
            await self.send_turn(initial_prompt)

    async def send_turn(
        self,
        prompt: str,
        *,
        client_message_id: str | None = None,
        message_already_audited: bool = False,
    ) -> str:
        """Audit a user message, serialize turn/start, and return its id."""

        async with self._turn_lock:
            client = self._require_client()
            if not self.provider_thread_id:
                raise RuntimeError("Chat runtime has no provider thread id")
            if self.active_turn_id is not None:
                raise TurnAlreadyActiveError("A Chat turn is already active")

            message_id = client_message_id or str(uuid.uuid4())
            if not message_already_audited:
                await self._clear_stale_errors()
                await self._append(
                    "thread.message-sent",
                    {
                        "id": message_id,
                        "role": "user",
                        "text": prompt,
                        "streaming": False,
                        "deliveryState": "pending",
                    },
                )
            try:
                response = await client.request(
                    "turn/start",
                    turn_start_params(
                        thread_id=self.provider_thread_id,
                        prompt=prompt,
                        model=self.model,
                        reasoning=self.reasoning,
                        service_tier=self.service_tier,
                    ),
                )
                turn = response.get("turn") if isinstance(response, dict) else None
                if not isinstance(turn, dict) or not turn.get("id"):
                    raise TypeError("turn/start returned no turn id")
                turn_id = str(turn["id"])
            except asyncio.CancelledError:
                await self._record_turn_start_failure(
                    message_id,
                    "turn/start was cancelled",
                    delivery_unknown=True,
                )
                raise
            except Exception as exc:
                message = sanitize_external_message(exc) or "turn/start failed"
                # A correlated JSON-RPC error proves the provider rejected the
                # request. Transport loss, protocol corruption, cancellation,
                # or a malformed success can all happen after the request was
                # accepted, so redelivery could duplicate autonomous work.
                delivery_unknown = not isinstance(exc, JsonRpcRemoteError)
                await self._record_turn_start_failure(
                    message_id,
                    message,
                    delivery_unknown=delivery_unknown,
                )
                raise TurnStartError(
                    message,
                    delivery_unknown=delivery_unknown,
                ) from exc

            # A fast provider can emit turn/completed before the correlated
            # turn/start response resumes this coroutine. Never resurrect that
            # already-terminal turn as active.
            if self._last_terminal_turn_id != turn_id:
                self.active_turn_id = turn_id
                await self._set_session(
                    status=AgentChatSession.Status.RUNNING,
                    active_turn_id=turn_id,
                    last_error=None,
                )
                await self._publish_lifecycle("working")
            return turn_id

    async def interrupt(self) -> None:
        client = self._require_client()
        if not self.provider_thread_id or not self.active_turn_id:
            return
        await client.request(
            "turn/interrupt",
            {
                "threadId": self.provider_thread_id,
                "turnId": self.active_turn_id,
            },
        )

    async def read_thread(self) -> dict[str, Any]:
        """Read the provider snapshot, also serving as an ordered stream barrier."""

        client = self._require_client()
        if not self.provider_thread_id:
            raise RuntimeError("Chat runtime has no provider thread id")
        response = await client.request(
            "thread/read",
            {"threadId": self.provider_thread_id, "includeTurns": True},
        )
        if not isinstance(response, dict):
            raise TypeError("thread/read returned a non-object response")
        return response

    async def respond_to_approval(self, request_id: str, decision: str) -> None:
        if decision not in {"accept", "acceptForSession", "decline", "cancel"}:
            raise ValueError("invalid approval decision")
        pending = self._claim_pending_request(request_id, APPROVAL_REQUEST_METHODS)
        available_decisions = pending.params.get("availableDecisions")
        if (
            isinstance(available_decisions, list)
            and available_decisions
            and decision not in available_decisions
        ):
            pending.resolving = False
            raise ValueError("approval decision is not available for this request")
        try:
            # Durable audit and attention-state publication must commit before
            # the provider is released to execute the approved operation.
            await self._append(
                "thread.approval-responded",
                {
                    "requestId": request_id,
                    "requestKind": pending.method,
                    "decision": decision,
                },
            )
            await self._publish_lifecycle(
                self._pending_lifecycle(excluding=request_id)
            )
        except BaseException:
            pending.resolving = False
            raise
        if pending.future.done():
            raise KeyError(request_id)
        pending.future.set_result({"decision": decision})

    async def respond_to_user_input(
        self,
        request_id: str,
        answers: dict[str, list[str]],
    ) -> None:
        pending = self._claim_pending_request(
            request_id,
            frozenset({USER_INPUT_REQUEST_METHOD}),
        )
        provider_answers = {
            question: {"answers": values} for question, values in answers.items()
        }
        secret_question_ids = {
            str(question.get("id"))
            for question in pending.params.get("questions", [])
            if isinstance(question, dict)
            and question.get("id") is not None
            and question.get("isSecret") is True
        }
        durable_answers = {
            question: ([REDACTED] if question in secret_question_ids else values)
            for question, values in answers.items()
        }
        try:
            await self._append(
                "thread.user-input-responded",
                {
                    "requestId": request_id,
                    "requestKind": pending.method,
                    "answers": durable_answers,
                },
            )
            await self._publish_lifecycle(
                self._pending_lifecycle(excluding=request_id)
            )
        except BaseException:
            pending.resolving = False
            raise
        if pending.future.done():
            raise KeyError(request_id)
        pending.future.set_result({"answers": provider_answers})

    async def close(self, *, resumable: bool = False) -> None:
        self._closing = True
        self._resumable_shutdown = resumable
        self._cancel_pending_requests()
        if self._client is not None:
            await self._client.close()
        if self._watch_task is not None and self._watch_task is not asyncio.current_task():
            await asyncio.gather(self._watch_task, return_exceptions=True)
        elif self._watch_task is None:
            await self._set_session(
                status=(
                    AgentChatSession.Status.INTERRUPTED
                    if resumable
                    else AgentChatSession.Status.STOPPED
                ),
                active_turn_id=None,
            )

    async def _on_notification(self, method: str, params: Any) -> None:
        if not self._is_root_notification(method, params):
            return

        event_type, payload = normalize_notification(method, params)
        if method == "error":
            payload = sanitize_error_payload(payload)

        if method == "serverRequest/resolved":
            request_id = payload.get("requestId")
            pending = (
                self._pending_requests.get(request_id)
                if isinstance(request_id, str)
                else None
            )
            await self._append(event_type, payload)
            if pending is not None:
                pending.resolution_recorded = True
                if not pending.future.done():
                    pending.future.cancel()
                await self._publish_lifecycle(
                    self._pending_lifecycle(excluding=request_id)
                )
            return

        if method == "thread/started" and isinstance(params, dict):
            thread = params.get("thread")
            if isinstance(thread, dict) and thread.get("id"):
                self.provider_thread_id = str(thread["id"])
                # Codex can emit this notification before the correlated
                # thread/start response. Persist the resume identity and its
                # audit event in one transaction so a crash in that window
                # cannot strand a real provider thread as non-resumable.
                await chat_database_sync_to_async(_record_provider_thread_started)(
                    self.agent_run_id,
                    self.provider_thread_id,
                    event_type,
                    payload,
                )
                return
        elif method == "turn/started" and isinstance(params, dict):
            turn_id = self._notification_turn_id(params)
            if turn_id and (
                self.active_turn_id is None or self.active_turn_id == turn_id
            ):
                self.active_turn_id = turn_id
                await self._set_session(
                    status=AgentChatSession.Status.RUNNING,
                    active_turn_id=turn_id,
                    last_error=None,
                )
                await self._publish_lifecycle("working")
        elif method == "turn/completed" and isinstance(params, dict):
            turn = params.get("turn")
            turn_id = self._notification_turn_id(params)
            if (
                not isinstance(turn, dict)
                or turn_id is None
                or (
                    self.active_turn_id is not None
                    and self.active_turn_id != turn_id
                )
            ):
                return
            turn_status = turn.get("status")
            if turn_status in {"completed", "interrupted", "failed"}:
                self._last_terminal_turn_id = turn_id
                if self.active_turn_id == turn_id:
                    self.active_turn_id = None
                if turn_status == "completed":
                    await self._set_session(
                        status=AgentChatSession.Status.READY,
                        active_turn_id=None,
                        last_error=None,
                    )
                    await self._publish_lifecycle("turn_complete")
                elif turn_status == "interrupted":
                    await self._set_session(
                        status=AgentChatSession.Status.INTERRUPTED,
                        active_turn_id=None,
                    )
                    await self._publish_lifecycle("quiet")
                else:
                    error = turn.get("error")
                    raw_message = (
                        error.get("message")
                        if isinstance(error, dict)
                        else "Codex turn failed"
                    )
                    message = sanitize_external_message(raw_message)
                    payload = sanitize_error_payload(payload)
                    await self._record_runtime_error(message, clear_active=True)
                    await self._publish_lifecycle("error")
        elif method == "error" and isinstance(params, dict):
            error = params.get("error")
            raw_message = (
                error.get("message") if isinstance(error, dict) else str(error)
            )
            message = sanitize_external_message(raw_message)
            if params.get("willRetry") is True:
                # Retryable provider errors are timeline diagnostics, not a
                # terminal attention-state transition.
                await self._publish_lifecycle("working")
            else:
                await self._record_runtime_error(message)
                await self._publish_lifecycle("error")
        await self._append(event_type, payload)

    def _on_request(
        self,
        provider_request_id: int | str,
        method: str,
        params: Any,
    ) -> ServerRequestOperation:
        """Synchronously register correlation, then await the user's response.

        ``JsonRpcStdioClient`` invokes this method before it reads the next
        buffered frame. The short ``ready`` barrier is released only after the
        requested event is durable, guaranteeing that an immediately following
        ``serverRequest/resolved`` event cannot overtake it.
        """

        typed_params = self._validate_server_request(method, params)
        request_id = str(provider_request_id)
        if request_id in self._pending_requests:
            raise JsonRpcServerRequestError(
                -32600,
                "Duplicate provider request id",
            )
        future = asyncio.get_running_loop().create_future()
        pending = PendingServerRequest(
            method=method,
            params=typed_params,
            future=future,
        )
        self._pending_requests[request_id] = pending
        event_type = (
            "thread.user-input-response-requested"
            if method == USER_INPUT_REQUEST_METHOD
            else "thread.approval-response-requested"
        )
        ready: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        result = self._await_server_request(
            request_id=request_id,
            pending=pending,
            event_type=event_type,
            typed_params=typed_params,
            ready=ready,
        )
        return ServerRequestOperation(result=result, ready=ready)

    async def _await_server_request(
        self,
        *,
        request_id: str,
        pending: PendingServerRequest,
        event_type: str,
        typed_params: dict[str, Any],
        ready: asyncio.Future[None],
    ) -> Any:
        try:
            await self._append(
                event_type,
                {
                    "requestId": request_id,
                    "requestKind": pending.method,
                    "payload": typed_params,
                },
            )
            pending.announced = True
            if not ready.done():
                ready.set_result(None)
            await self._publish_lifecycle(self._pending_lifecycle())
            return await pending.future
        except asyncio.CancelledError:
            if not ready.done():
                ready.cancel()
            if pending.announced and not pending.resolution_recorded:
                pending.resolution_recorded = True
                try:
                    await self._append(
                        "thread.request-resolved",
                        {
                            "requestId": request_id,
                            "requestKind": pending.method,
                            "reason": "process_ended",
                            "cancelled": True,
                        },
                    )
                    await self._publish_lifecycle(
                        self._pending_lifecycle(excluding=request_id)
                    )
                except Exception as exc:
                    logger.warning(
                        "failed to record cancelled Chat request %s: %s",
                        request_id,
                        sanitize_external_message(exc),
                    )
            raise
        except BaseException as exc:
            if not ready.done():
                ready.set_exception(exc)
            raise
        finally:
            self._pending_requests.pop(request_id, None)

    def _validate_server_request(self, method: str, params: Any) -> dict[str, Any]:
        if method not in SUPPORTED_SERVER_REQUEST_METHODS:
            raise JsonRpcServerRequestError(
                -32601,
                f"Unsupported server request: {method}",
            )
        if not isinstance(params, dict):
            raise JsonRpcServerRequestError(-32602, "Request params must be an object")
        thread_id = params.get("threadId")
        turn_id = params.get("turnId")
        if not isinstance(thread_id, str) or not thread_id:
            raise JsonRpcServerRequestError(-32602, "Request has no threadId")
        if not isinstance(turn_id, str) or not turn_id:
            raise JsonRpcServerRequestError(-32602, "Request has no turnId")
        if self.provider_thread_id and thread_id != self.provider_thread_id:
            raise JsonRpcServerRequestError(
                -32602,
                "Request does not belong to the root Chat thread",
            )
        if self.active_turn_id and turn_id != self.active_turn_id:
            raise JsonRpcServerRequestError(
                -32602,
                "Request does not belong to the active Chat turn",
            )
        if method == USER_INPUT_REQUEST_METHOD and not isinstance(
            params.get("questions"), list
        ):
            raise JsonRpcServerRequestError(-32602, "User-input request has no questions")
        return dict(params)

    def _claim_pending_request(
        self,
        request_id: str,
        expected_methods: frozenset[str],
    ) -> PendingServerRequest:
        pending = self._pending_requests.get(request_id)
        if pending is None or pending.future.done() or pending.resolving:
            raise KeyError(request_id)
        if pending.method not in expected_methods:
            raise RequestKindMismatchError(
                f"request {request_id} expects a different response kind"
            )
        # Claim synchronously before the first await so concurrent responders
        # cannot both write audit rows for the same provider future.
        pending.resolving = True
        return pending

    def _pending_lifecycle(self, *, excluding: str | None = None) -> str:
        pending = [
            request
            for request_id, request in self._pending_requests.items()
            if request_id != excluding and not request.future.done()
        ]
        if any(request.method == USER_INPUT_REQUEST_METHOD for request in pending):
            return "needs_input"
        if any(request.method in APPROVAL_REQUEST_METHODS for request in pending):
            return "permission_required"
        return "working"

    def _is_root_notification(self, method: str, params: Any) -> bool:
        if not isinstance(params, dict):
            return method not in {"turn/started", "turn/completed", "error"}
        if method == "thread/started":
            thread = params.get("thread")
            thread_id = thread.get("id") if isinstance(thread, dict) else None
        else:
            thread_id = params.get("threadId")
        if (
            self.provider_thread_id
            and isinstance(thread_id, str)
            and thread_id != self.provider_thread_id
        ):
            return False
        turn_id = self._notification_turn_id(params)
        if (
            method != "turn/started"
            and self.active_turn_id
            and turn_id
            and turn_id != self.active_turn_id
        ):
            return False
        return True

    @staticmethod
    def _notification_turn_id(params: dict[str, Any]) -> str | None:
        turn_id = params.get("turnId")
        if turn_id:
            return str(turn_id)
        turn = params.get("turn")
        if isinstance(turn, dict) and turn.get("id"):
            return str(turn["id"])
        return None

    async def _clear_stale_errors(self) -> None:
        await chat_database_sync_to_async(_clear_retry_state)(
            self.agent_run_id
        )

    async def _record_runtime_error(
        self,
        message: str,
        *,
        clear_active: bool = False,
    ) -> None:
        safe_message = sanitize_external_message(message) or "Codex Chat failed"
        changes: dict[str, Any] = dict(
            status=AgentChatSession.Status.ERROR,
            last_error=safe_message,
        )
        if clear_active:
            changes["active_turn_id"] = None
        await self._set_session(**changes)
        await chat_database_sync_to_async(
            AgentRun.objects.filter(id=self.agent_run_id).update
        )(error=safe_message)

    async def _record_turn_start_failure(
        self,
        message_id: str,
        message: str,
        *,
        delivery_unknown: bool = False,
    ) -> None:
        safe_message = sanitize_external_message(message) or "turn/start failed"
        payload: dict[str, Any] = {
            "id": message_id,
            "role": "user",
            "phase": "turn/start",
            "error": safe_message,
        }
        if delivery_unknown:
            payload.update(
                {
                    "deliveryUnknown": True,
                    "retryable": False,
                }
            )
        await self._append(
            "thread.message-failed",
            payload,
        )
        await self._record_runtime_error(safe_message)
        await self._publish_lifecycle("error")

    def _cancel_pending_requests(self) -> None:
        for pending in tuple(self._pending_requests.values()):
            if not pending.future.done():
                pending.future.cancel()

    async def _watch_process(self) -> None:
        assert self._client is not None
        containment_failed = False
        try:
            returncode = await self._client.wait()
            self._cancel_pending_requests()
            orphaned_turn_id = self.active_turn_id
            self.active_turn_id = None
            unexpected_clean_exit = not self._closing and returncode == 0
            if self._resumable_shutdown or unexpected_clean_exit:
                status = AgentChatSession.Status.INTERRUPTED
                message = sanitize_external_message(
                    (
                        "Ticketry backend stopped; the Codex thread can be resumed."
                        if self._resumable_shutdown
                        else "Codex app-server exited; the thread can be resumed."
                    )
                )
                lifecycle = "quiet"
                ended = False
                run_status = "interrupted"
            elif self._closing:
                status = AgentChatSession.Status.STOPPED
                message = None
                lifecycle = "exited"
                ended = True
                run_status = "exited"
            else:
                status = AgentChatSession.Status.ERROR
                message = sanitize_external_message(
                    f"Codex app-server exited with code {returncode}"
                )
                lifecycle = "error"
                ended = True
                run_status = "exited"
            await self._set_session(
                status=status,
                active_turn_id=None,
                last_error=message,
                resume_token=None,
            )
            await self._append(
                (
                    "thread.session-interrupted"
                    if status == AgentChatSession.Status.INTERRUPTED
                    else "thread.session-exited"
                ),
                {
                    "status": status,
                    "exitCode": returncode,
                    "error": message,
                    "activeTurnId": orphaned_turn_id,
                    "resumable": bool(
                        self.provider_thread_id
                        and status
                        in {
                            AgentChatSession.Status.INTERRUPTED,
                            AgentChatSession.Status.ERROR,
                        }
                    ),
                },
            )
            await self._publish_lifecycle(
                lifecycle,
                ended=ended,
                run_status=run_status,
            )
        except asyncio.CancelledError:
            self._cancel_pending_requests()
            raise
        except JsonRpcContainmentError as exc:
            containment_failed = True
            self._cancel_pending_requests()
            logger.error(
                "Chat runtime %s remains owned after containment failure: %s",
                self.agent_run_id,
                sanitize_external_message(exc),
            )
        except Exception as exc:
            self._cancel_pending_requests()
            logger.warning(
                "failed to reconcile exited Chat runtime %s: %s",
                self.agent_run_id,
                sanitize_external_message(exc),
            )
        finally:
            if not containment_failed and self._on_exit is not None:
                try:
                    await self._on_exit(self)
                except Exception as exc:
                    logger.warning(
                        "failed to clean up exited Chat runtime %s: %s",
                        self.agent_run_id,
                        sanitize_external_message(exc),
                    )

    def _require_client(self) -> JsonRpcStdioClient:
        if self._client is None:
            raise RuntimeError("Chat runtime is not started")
        return self._client

    async def _append(self, event_type: str, payload: dict[str, Any]) -> None:
        await chat_database_sync_to_async(append_event)(
            agent_run_id=self.agent_run_id,
            event_type=event_type,
            payload=payload,
        )

    async def _set_session(self, **changes: Any) -> None:
        await chat_database_sync_to_async(
            AgentChatSession.objects.filter(run_id=self.agent_run_id).update
        )(**changes)

    async def _publish_lifecycle(
        self,
        state: str,
        *,
        ended: bool = False,
        run_status: str | None = None,
    ) -> None:
        at = datetime.now(timezone.utc).isoformat()
        record = await chat_database_sync_to_async(_update_run_lifecycle)(
            self.agent_run_id,
            state,
            at,
            ended,
            run_status,
        )
        if record is None:
            return
        project_id, run_record = record
        await publish_status(
            project_id,
            AgentLifecycleFrame(at=at, run=run_record).model_dump(),
        )


@transaction.atomic
def _record_provider_thread_started(
    agent_run_id: str,
    provider_thread_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Commit an early provider-thread identity with its native event."""

    session = AgentChatSession.objects.select_for_update().get(run_id=agent_run_id)
    session.provider_thread_id = provider_thread_id
    session.save(update_fields=["provider_thread_id", "updated_at"])
    append_event(
        agent_run_id=agent_run_id,
        event_type=event_type,
        payload=payload,
    )


def _clear_retry_state(agent_run_id: str) -> None:
    """Clear stale launch/turn diagnostics immediately before a retry."""

    AgentRun.objects.filter(id=agent_run_id).update(
        status="running",
        ended_at=None,
        error=None,
    )
    session = AgentChatSession.objects.filter(run_id=agent_run_id).first()
    if session is None:
        return
    changes: dict[str, Any] = {"last_error": None}
    if session.status in {
        AgentChatSession.Status.ERROR,
        AgentChatSession.Status.INTERRUPTED,
    }:
        changes["status"] = AgentChatSession.Status.READY
    AgentChatSession.objects.filter(run_id=agent_run_id).update(**changes)


def _update_run_lifecycle(
    agent_run_id: str,
    state: str,
    at: str,
    ended: bool,
    run_status: str | None = None,
) -> tuple[str, RunRecord] | None:
    """Persist and project one app-server lifecycle transition."""

    try:
        run = AgentRun.objects.select_related("issue").get(id=agent_run_id)
    except AgentRun.DoesNotExist:
        return None
    run.lifecycle_state = state
    run.lifecycle_updated_at = at
    update_fields = ["lifecycle_state", "lifecycle_updated_at"]
    if run_status is not None:
        run.status = run_status
        update_fields.append("status")
    if ended:
        run.status = run_status or "exited"
        run.ended_at = at
        if "status" not in update_fields:
            update_fields.append("status")
        update_fields.append("ended_at")
    elif run_status == "interrupted":
        run.ended_at = None
        update_fields.append("ended_at")
    run.save(update_fields=update_fields)
    issue = run.issue
    project_id = str(issue.project_id)
    task_id = str(issue.id) if issue.type == "task" else None
    module_id = str(issue.module_id or issue.id)
    return project_id, RunRecord(
        agent_run_id=run.id,
        project_id=project_id,
        task_id=task_id,
        module_id=module_id,
        agent=run.agent,
        run_kind=run.run_kind,
        scope=run.scope,
        started_at=run.started_at,
        state=state,
        updated_at=at,
    )


class CodexChatRuntimeRegistry:
    """Process-local ownership table for live Chat subprocesses."""

    def __init__(self):
        self._runtimes: dict[str, CodexChatRuntime] = {}
        self._lock = asyncio.Lock()

    async def add(self, runtime: CodexChatRuntime, initial_prompt: str | None = None) -> None:
        async with self._lock:
            if runtime.agent_run_id in self._runtimes:
                raise RuntimeError("Chat runtime already exists")
            runtime._on_exit = self._discard
            self._runtimes[runtime.agent_run_id] = runtime
        try:
            await runtime.start(initial_prompt)
        except BaseException as start_error:
            runtime._on_exit = None
            try:
                await runtime.close()
            except BaseException as close_error:
                async with self._lock:
                    if self._runtimes.get(runtime.agent_run_id) is runtime:
                        runtime._on_exit = self._discard
                logger.warning(
                    "failed to close partially started Chat runtime %s: %s",
                    runtime.agent_run_id,
                    sanitize_external_message(close_error),
                )
                if isinstance(close_error, asyncio.CancelledError):
                    raise
                raise RuntimeError(
                    "Partially started Chat runtime could not be contained"
                ) from close_error
            async with self._lock:
                if self._runtimes.get(runtime.agent_run_id) is runtime:
                    self._runtimes.pop(runtime.agent_run_id, None)
            raise start_error

    def get(self, agent_run_id: str) -> CodexChatRuntime:
        try:
            return self._runtimes[agent_run_id]
        except KeyError as exc:
            raise KeyError(f"No live Chat runtime for {agent_run_id}") from exc

    async def remove(self, agent_run_id: str, *, resumable: bool = False) -> None:
        async with self._lock:
            runtime = self._runtimes.get(agent_run_id)
            if runtime is not None:
                runtime._on_exit = None
        if runtime is None:
            return
        try:
            await runtime.close(resumable=resumable)
        except BaseException:
            # Failed/cancelled containment keeps a discoverable owner so a
            # later End/Close can retry instead of reporting false success.
            async with self._lock:
                if self._runtimes.get(agent_run_id) is runtime:
                    runtime._on_exit = self._discard
            raise
        async with self._lock:
            if self._runtimes.get(agent_run_id) is runtime:
                self._runtimes.pop(agent_run_id, None)

    async def close_all(self) -> None:
        """Interrupt every process, retaining any owner that fails to close."""

        async with self._lock:
            runtimes = tuple(self._runtimes.values())
            for runtime in runtimes:
                runtime._on_exit = None
        results = await asyncio.gather(
            *(self._close_for_shutdown(runtime) for runtime in runtimes),
            return_exceptions=True,
        )
        failures = [result for result in results if result is not True]
        if failures:
            raise RuntimeError(
                f"Failed to contain {len(failures)} Chat runtime(s) during shutdown"
            )

    async def _close_for_shutdown(self, runtime: CodexChatRuntime) -> bool:
        try:
            runtime._on_exit = None
            await runtime.close(resumable=True)
        except BaseException as exc:
            async with self._lock:
                if self._runtimes.get(runtime.agent_run_id) is runtime:
                    runtime._on_exit = self._discard
            if isinstance(exc, asyncio.CancelledError):
                raise
            logger.warning(
                "failed to close Chat runtime %s during shutdown: %s",
                runtime.agent_run_id,
                sanitize_external_message(exc),
            )
            return False
        async with self._lock:
            if self._runtimes.get(runtime.agent_run_id) is runtime:
                self._runtimes.pop(runtime.agent_run_id, None)
        await self._cleanup_runtime(runtime)
        return True

    async def _discard(self, runtime: CodexChatRuntime) -> None:
        async with self._lock:
            if self._runtimes.get(runtime.agent_run_id) is runtime:
                self._runtimes.pop(runtime.agent_run_id, None)
        # A provider process can exit without going through ChatSessionService
        # (crash, authentication failure, or a graceful provider-side close).
        # Mirror the explicit stop path so its document watcher and narrowly
        # scoped launch artifacts do not remain live until backend shutdown.
        await self._cleanup_runtime(runtime)

    @staticmethod
    async def _cleanup_runtime(runtime: CodexChatRuntime) -> None:
        try:
            from apps.documents import watch as documents_watch
            from apps.terminals.agents.registry import (
                cleanup_temporary_artifacts_for_run,
            )

            documents_watch.stop_watch(runtime.agent_run_id)
            cleanup_temporary_artifacts_for_run(runtime.agent_run_id)
        except Exception as exc:
            logger.warning(
                "failed to clean up exited Chat runtime %s: %s",
                runtime.agent_run_id,
                sanitize_external_message(exc),
            )


runtime_registry = CodexChatRuntimeRegistry()
