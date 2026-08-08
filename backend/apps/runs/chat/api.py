"""Transport-independent application API for structured Chat runs."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Literal

from django.db import transaction
from django.utils import timezone
from pydantic import BaseModel, Field

from apps.errors import ApplicationError
from apps.runs.chat.codex_runtime import TurnStartError
from apps.runs.chat.events import AppendedChatEvent, replay_events
from apps.runs.chat.jsonrpc import JsonRpcClientError
from apps.runs.chat.runtime_supervisor import runtime_supervisor
from apps.runs.chat.safety import sanitize_external_message
from apps.runs.chat.service import ChatRunError, chat_session
from apps.runs.models import AgentChatLaunchCommand, AgentChatSession, AgentRun
from apps.settings_store.config import NoConfigurationSelected
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.control_plane import launch_intent_from_spawn
from apps.terminals.launch_configuration import LaunchConfigurationError
from apps.terminals.validation import SpawnRequest, _validate_init


class CreateChatRunBody(BaseModel):
    """Inputs shared with a Terminal launch before the transport split."""

    agent: str = "codex"
    project_id: str
    module_id: str
    task_id: str | None = None
    initial_prompt: str | None = None
    is_planning: bool = False
    is_instant: bool = False
    instant_prompt: str | None = None
    command_id: str | None = Field(default=None, min_length=1, max_length=128)


class SendTurnBody(BaseModel):
    prompt: str
    command_id: str | None = Field(default=None, min_length=1, max_length=128)


class ApprovalResponseBody(BaseModel):
    request_id: str
    decision: Literal["accept", "acceptForSession", "decline", "cancel"]


class UserInputResponseBody(BaseModel):
    request_id: str
    answers: dict[str, list[str]] = Field(default_factory=dict)


def _spawn_request(body: CreateChatRunBody) -> SpawnRequest:
    request, error = _validate_init(
        {
            "type": "init",
            "mode": "spawn",
            "cols": 1,
            "rows": 1,
            **body.model_dump(exclude={"command_id"}),
            "is_doc_chat": False,
            "doc_rel_path": None,
            "doc_id": None,
        }
    )
    if error is not None:
        raise ApplicationError(400, error, code=error)
    assert isinstance(request, SpawnRequest)
    if request.agent != "codex":
        raise ApplicationError(
            400,
            "chat_provider_unsupported",
            code="chat_provider_unsupported",
        )
    return request


def _application_error(exc: ChatRunError) -> ApplicationError:
    if exc.code == "chat_not_found":
        status = 404
    elif exc.code in {
        "chat_runtime_unavailable",
        "turn_already_active",
        "request_not_pending",
        "request_kind_mismatch",
        "command_id_conflict",
        "command_in_progress",
        "command_failed",
        "run_still_active",
        "runtime_state_conflict",
        "no_provider_thread_id",
        "cwd_missing",
    }:
        status = 409
    else:
        status = 400
    return ApplicationError(status, exc.code, code=exc.code)


def _create_chat_fingerprint(body: CreateChatRunBody) -> str:
    payload = body.model_dump(mode="json", exclude={"command_id"})
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@transaction.atomic
def _claim_create_chat_command(
    command_id: str,
    request_fingerprint: str,
) -> tuple[bool, str]:
    reserved_run_id = uuid.uuid4().hex
    command, created = AgentChatLaunchCommand.objects.get_or_create(
        command_id=command_id,
        defaults={
            "request_fingerprint": request_fingerprint,
            "agent_run_id": reserved_run_id,
        },
    )
    if not created:
        command = AgentChatLaunchCommand.objects.select_for_update().get(
            pk=command.pk
        )
    if command.request_fingerprint != request_fingerprint:
        raise ChatRunError("command_id_conflict")
    if created:
        return True, command.agent_run_id
    if command.status == AgentChatLaunchCommand.Status.COMPLETED:
        return False, command.agent_run_id
    if command.status == AgentChatLaunchCommand.Status.PENDING:
        raise ChatRunError("command_in_progress")

    # A failed claim is retryable when its reserved run was cleaned up or when
    # restart reconciliation proved that it ended before any provider thread
    # existed. Preserve the dead run as history, but reserve a fresh identity
    # for the safe retry. Any live/resumable resource remains failed closed.
    reserved_session = (
        AgentChatSession.objects.select_related("run")
        .filter(run_id=command.agent_run_id)
        .first()
    )
    if reserved_session is not None:
        is_definitely_dead_pre_thread = (
            not reserved_session.provider_thread_id
            and reserved_session.run.status in {"exited", "terminated"}
        )
        if not is_definitely_dead_pre_thread:
            raise ChatRunError("command_failed")
    elif AgentRun.objects.filter(id=command.agent_run_id).exists():
        raise ChatRunError("command_failed")
    command.status = AgentChatLaunchCommand.Status.PENDING
    command.agent_run_id = reserved_run_id
    command.error = None
    command.save(update_fields=["status", "agent_run_id", "error", "updated_at"])
    return True, command.agent_run_id


@transaction.atomic
def _complete_create_chat_command(
    command_id: str,
    request_fingerprint: str,
    agent_run_id: str,
) -> None:
    command = AgentChatLaunchCommand.objects.select_for_update().get(
        command_id=command_id
    )
    if (
        command.request_fingerprint != request_fingerprint
        or command.agent_run_id != agent_run_id
    ):
        raise ChatRunError("command_id_conflict")
    if command.status == AgentChatLaunchCommand.Status.COMPLETED:
        return
    if command.status != AgentChatLaunchCommand.Status.PENDING:
        raise ChatRunError("command_failed")
    command.status = AgentChatLaunchCommand.Status.COMPLETED
    command.error = None
    command.save(update_fields=["status", "error", "updated_at"])


def _fail_create_chat_command(
    command_id: str,
    request_fingerprint: str,
    agent_run_id: str,
    error: object,
) -> None:
    AgentChatLaunchCommand.objects.filter(
        command_id=command_id,
        request_fingerprint=request_fingerprint,
        agent_run_id=agent_run_id,
        status=AgentChatLaunchCommand.Status.PENDING,
    ).update(
        status=AgentChatLaunchCommand.Status.FAILED,
        error=sanitize_external_message(error) or error.__class__.__name__,
        updated_at=timezone.now(),
    )


def create_chat(body: CreateChatRunBody) -> dict[str, str]:
    """Resolve shared launch facts and start one managed Codex app-server."""

    request = _spawn_request(body)
    intent = launch_intent_from_spawn(request)
    command_id = body.command_id
    request_fingerprint: str | None = None
    reserved_run_id: str | None = None
    if command_id is not None:
        request_fingerprint = _create_chat_fingerprint(body)
        try:
            should_launch, reserved_run_id = _claim_create_chat_command(
                command_id,
                request_fingerprint,
            )
        except ChatRunError as exc:
            raise _application_error(exc) from exc
        if not should_launch:
            return {"agent_run_id": reserved_run_id}
    try:
        try:
            agent_run_id = runtime_supervisor.call_sync(
                lambda: chat_session.spawn(
                    intent,
                    agent_run_id=reserved_run_id,
                ),
                timeout=60,
            )
        except Exception as exc:
            if (
                command_id is not None
                and request_fingerprint is not None
                and reserved_run_id is not None
            ):
                _fail_create_chat_command(
                    command_id,
                    request_fingerprint,
                    reserved_run_id,
                    exc,
                )
            raise
    except RequiredSkillUnavailable as exc:
        raise ApplicationError(409, exc.message, body=exc.as_payload()) from exc
    except NoConfigurationSelected as exc:
        raise ApplicationError(
            400,
            "no_profile_selected",
            code="no_profile_selected",
        ) from exc
    except LaunchConfigurationError as exc:
        raise ApplicationError(400, exc.code, code=exc.code) from exc
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except (JsonRpcClientError, OSError, RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            503,
            sanitize_external_message(exc) or "chat_launch_unavailable",
            code="chat_launch_unavailable",
        ) from exc
    if (
        command_id is not None
        and request_fingerprint is not None
        and reserved_run_id is not None
    ):
        try:
            _complete_create_chat_command(
                command_id,
                request_fingerprint,
                agent_run_id,
            )
        except ChatRunError as exc:
            raise _application_error(exc) from exc
    return {"agent_run_id": agent_run_id}


def _event_payload(event: AppendedChatEvent) -> dict:
    return {
        "sequence": event.sequence,
        "event_type": event.event_type,
        "payload": event.payload,
        "created_at": event.created_at,
    }


def _run_scope(run: AgentRun) -> tuple[str, str, str | None]:
    issue = run.issue
    project_id = str(issue.project_id)
    if issue.module_id:
        return project_id, str(issue.module_id), str(issue.id)
    return project_id, str(issue.id), None


def _run_payload(run: AgentRun) -> dict:
    project_id, module_id, task_id = _run_scope(run)
    return {
        "agent_run_id": run.id,
        "project_id": project_id,
        "module_id": module_id,
        "task_id": task_id,
        "agent": run.agent,
        "run_kind": run.run_kind,
        "scope": run.scope,
        "status": run.status,
        "state": run.lifecycle_state,
        "started_at": run.started_at,
        "ended_at": run.ended_at,
        "cwd": run.cwd,
    }


def _session_payload(session: AgentChatSession) -> dict:
    return {
        "provider_thread_id": session.provider_thread_id,
        "status": session.status,
        "active_turn_id": session.active_turn_id,
        "last_error": session.last_error,
        "next_sequence": session.next_sequence,
        "last_sequence": max(0, session.next_sequence - 1),
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
    }


@transaction.atomic
def get_chat_snapshot(
    agent_run_id: str,
    after: int = 0,
    through: int | None = None,
) -> dict:
    """Read one cursor-bounded durable transcript snapshot.

    Locking the session row gives callers (especially a reconnecting WebSocket)
    an exact handoff cursor: an append is either included through ``cursor`` or
    happens after the lock is released and is therefore a live delta.
    """

    if after < 0:
        raise ApplicationError(400, "invalid_cursor", code="invalid_cursor")
    if through is not None and through < 0:
        raise ApplicationError(400, "invalid_cursor", code="invalid_cursor")
    try:
        session = (
            AgentChatSession.objects.select_for_update()
            .select_related("run", "run__issue")
            .get(run_id=agent_run_id, run__run_kind=AgentRun.Kind.CHAT)
        )
    except AgentChatSession.DoesNotExist:
        raise ApplicationError(404, "chat_not_found", code="chat_not_found") from None

    last_sequence = max(0, session.next_sequence - 1)
    cursor = last_sequence if through is None else min(through, last_sequence)
    if after > cursor:
        raise ApplicationError(
            409,
            "chat_cursor_ahead",
            code="chat_cursor_ahead",
            metadata={"cursor": cursor, "after": after},
        )
    events = replay_events(
        agent_run_id=agent_run_id,
        after=after,
        through=cursor,
    )
    return {
        "run": _run_payload(session.run),
        "session": _session_payload(session),
        "events": [_event_payload(event) for event in events],
        "cursor": cursor,
    }


def list_chats(
    *,
    task_id: str | None = None,
    project_id: str | None = None,
    module_id: str | None = None,
) -> list[dict]:
    """List Chat sessions in the same task/scratch scopes as Terminal runs."""

    rows = AgentChatSession.objects.select_related("run", "run__issue").filter(
        run__run_kind=AgentRun.Kind.CHAT
    )
    if task_id:
        rows = rows.filter(run__issue_id=task_id)
    elif project_id:
        rows = rows.filter(run__issue__project_id=project_id)
        if module_id:
            rows = rows.filter(run__issue_id=module_id)
        rows = rows.filter(run__scope__in=("plan", "instant"))
    else:
        raise ApplicationError(
            400,
            "task_id_or_project_id_required",
            code="task_id_or_project_id_required",
        )

    payloads: list[dict] = []
    for session in rows.order_by("-run__started_at", "-run_id"):
        run = _run_payload(session.run)
        payloads.append(
            {
                **run,
                "status": session.status,
                "run_status": run["status"],
                "active_turn_id": session.active_turn_id,
                "last_error": session.last_error,
                "updated_at": session.updated_at.isoformat(),
                "last_sequence": max(0, session.next_sequence - 1),
            }
        )
    return payloads


def read_chat(agent_run_id: str, *, after: int = 0) -> dict:
    """Use provider ``thread/read`` as a barrier, then return normalized state."""

    try:
        runtime_supervisor.call_sync(lambda: chat_session.read(agent_run_id))
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except (JsonRpcClientError, RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            409, sanitize_external_message(exc), code="chat_read_failed"
        ) from exc
    return get_chat_snapshot(agent_run_id, after=after)


def resume_chat(agent_run_id: str) -> dict[str, str | bool]:
    """Resume a durable provider thread after its owning backend process ended."""

    try:
        resumed_id = runtime_supervisor.call_sync(
            lambda: chat_session.resume(agent_run_id),
            timeout=60,
        )
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except (JsonRpcClientError, OSError, RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            503,
            sanitize_external_message(exc) or "chat_resume_unavailable",
            code="chat_resume_unavailable",
        ) from exc
    return {"agent_run_id": resumed_id, "resumed": True}


def send_turn(agent_run_id: str, body: SendTurnBody) -> dict[str, str]:
    try:
        turn_id = runtime_supervisor.call_sync(
            lambda: chat_session.send_turn(
                agent_run_id,
                body.prompt,
                command_id=body.command_id,
            )
        )
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except TurnStartError as exc:
        raise ApplicationError(
            409,
            sanitize_external_message(exc),
            code=(
                "turn_delivery_unknown"
                if exc.delivery_unknown
                else "turn_start_failed"
            ),
        ) from exc
    except (JsonRpcClientError, RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            409,
            sanitize_external_message(exc),
            code="turn_start_failed",
        ) from exc
    return {"turn_id": turn_id}


def interrupt_chat(agent_run_id: str) -> dict[str, bool]:
    try:
        interrupted = runtime_supervisor.call_sync(
            lambda: chat_session.interrupt(agent_run_id)
        )
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except (JsonRpcClientError, RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            409, sanitize_external_message(exc), code="chat_interrupt_failed"
        ) from exc
    return {"interrupted": interrupted}


def respond_to_approval(
    agent_run_id: str,
    body: ApprovalResponseBody,
) -> dict[str, bool]:
    try:
        runtime_supervisor.call_sync(
            lambda: chat_session.respond_to_approval(
                agent_run_id,
                body.request_id,
                body.decision,
            )
        )
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except ValueError as exc:
        raise ApplicationError(
            400, "invalid_approval_decision", code="invalid_approval_decision"
        ) from exc
    except (RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            409,
            sanitize_external_message(exc),
            code="approval_response_failed",
        ) from exc
    return {"accepted": True}


def respond_to_user_input(
    agent_run_id: str,
    body: UserInputResponseBody,
) -> dict[str, bool]:
    try:
        runtime_supervisor.call_sync(
            lambda: chat_session.respond_to_user_input(
                agent_run_id,
                body.request_id,
                body.answers,
            )
        )
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except (RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            409,
            sanitize_external_message(exc),
            code="user_input_response_failed",
        ) from exc
    return {"accepted": True}


def stop_chat(agent_run_id: str) -> dict[str, str | bool]:
    try:
        stopped_live_process = runtime_supervisor.call_sync(
            lambda: chat_session.stop(agent_run_id)
        )
    except ChatRunError as exc:
        raise _application_error(exc) from exc
    except (RuntimeError, TimeoutError) as exc:
        raise ApplicationError(
            503, sanitize_external_message(exc), code="chat_stop_failed"
        ) from exc
    return {
        "agent_run_id": agent_run_id,
        "stopped": True,
        "stopped_live_process": stopped_live_process,
    }
