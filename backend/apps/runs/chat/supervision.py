"""Backend-lifetime reconciliation for structured Chat processes."""

from __future__ import annotations

from datetime import datetime, timezone

from django.db import transaction

from apps.runs.chat.events import append_event
from apps.runs.models import (
    AgentChatCommand,
    AgentChatLaunchCommand,
    AgentChatSession,
    AgentRun,
)


RESTART_DELIVERY_UNKNOWN = (
    "Ticketry backend restarted before turn delivery could be confirmed."
)
RESTART_LAUNCH_INCOMPLETE = (
    "Ticketry backend restarted before Chat launch could be confirmed."
)


@transaction.atomic
def reconcile_orphaned_sessions() -> int:
    """Reconcile active Chat runs whose process was lost across a restart.

    A process-local registry is necessarily empty after a sidecar restart. The
    session status alone cannot identify these orphans: a live process may have
    left its session in ``error`` after a failed turn or ``interrupted`` after
    a turn interrupt. The shared run row remains ``running`` until the process
    actually exits, so it is the durable source of truth for liveness here.

    A provider thread id makes the orphan resumable. A launch lost before Codex
    returned that id is terminal instead; advertising a resume action would
    only send the user into ``no_provider_thread_id``.
    """

    sessions = list(
        AgentChatSession.objects.select_for_update()
        .select_related("run")
        .filter(
            run__run_kind=AgentRun.Kind.CHAT,
            run__status="running",
            run__ended_at__isnull=True,
        )
    )
    at = datetime.now(timezone.utc).isoformat()
    for session in sessions:
        agent_run_id = session.run_id
        if session.provider_thread_id:
            message = "Ticketry backend restarted; the Codex thread can be resumed."
            AgentChatSession.objects.filter(run_id=agent_run_id).update(
                status=AgentChatSession.Status.INTERRUPTED,
                active_turn_id=None,
                last_error=message,
                resume_token=None,
            )
            AgentRun.objects.filter(id=agent_run_id).update(
                status="interrupted",
                ended_at=None,
                error=message,
                lifecycle_state="quiet",
                lifecycle_updated_at=at,
            )
            append_event(
                agent_run_id=agent_run_id,
                event_type="thread.session-interrupted",
                payload={
                    "reason": "backend_restart",
                    "resumable": True,
                    "activeTurnId": session.active_turn_id,
                },
            )
            continue

        message = (
            "Ticketry backend restarted before Codex created a resumable thread."
        )
        AgentChatSession.objects.filter(run_id=agent_run_id).update(
            status=AgentChatSession.Status.ERROR,
            active_turn_id=None,
            last_error=message,
            resume_token=None,
        )
        AgentRun.objects.filter(id=agent_run_id).update(
            status="exited",
            ended_at=at,
            error=message,
            lifecycle_state="error",
            lifecycle_updated_at=at,
        )
        append_event(
            agent_run_id=agent_run_id,
            event_type="thread.error",
            payload={
                "phase": "backend_restart",
                "message": message,
                "resumable": False,
                "activeTurnId": session.active_turn_id,
            },
        )
    return len(sessions)


@transaction.atomic
def reconcile_orphaned_commands() -> int:
    """Resolve command claims whose owning coroutine died with the backend.

    Launch claims become completed when a durable provider thread proves that
    the Chat resource exists; otherwise they become retryable failures. Turn
    claims are retried only when no message audit was committed. Once delivery
    audit exists, an unknown outcome is failed closed to prevent a duplicate
    provider turn, while a durable turn-start recovers the original result.
    """

    reconciled = 0
    launch_commands = list(
        AgentChatLaunchCommand.objects.select_for_update().filter(
            status=AgentChatLaunchCommand.Status.PENDING
        )
    )
    for command in launch_commands:
        session = (
            AgentChatSession.objects.select_related("run")
            .filter(run_id=command.agent_run_id)
            .first()
        )
        if session is not None and session.provider_thread_id:
            command.status = AgentChatLaunchCommand.Status.COMPLETED
            command.error = None
        else:
            command.status = AgentChatLaunchCommand.Status.FAILED
            command.error = RESTART_LAUNCH_INCOMPLETE
        command.save(update_fields=["status", "error", "updated_at"])
        reconciled += 1

    turn_commands = list(
        AgentChatCommand.objects.select_for_update()
        .select_related("session")
        .filter(status=AgentChatCommand.Status.PENDING)
    )
    for command in turn_commands:
        if command.command_type != "start_turn":
            command.status = AgentChatCommand.Status.FAILED
            command.error = "Unsupported Chat command was interrupted by restart."
            command.save(update_fields=["status", "error", "updated_at"])
            reconciled += 1
            continue

        events = list(command.session.events.order_by("sequence"))
        message_event = next(
            (
                event
                for event in events
                if event.event_type == "thread.message-sent"
                and event.payload.get("id") == command.command_id
            ),
            None,
        )
        if message_event is None:
            # The command claim precedes provider delivery audit. Removing it
            # lets an identical retry safely reclaim the same command id.
            command.delete()
            reconciled += 1
            continue

        later_events = [
            event for event in events if event.sequence > message_event.sequence
        ]
        failed_event = next(
            (
                event
                for event in later_events
                if event.event_type == "thread.message-failed"
                and event.payload.get("id") == command.command_id
            ),
            None,
        )
        if failed_event is not None:
            command.status = AgentChatCommand.Status.FAILED
            command.error = str(
                failed_event.payload.get("error") or RESTART_DELIVERY_UNKNOWN
            )
            command.save(update_fields=["status", "error", "updated_at"])
            reconciled += 1
            continue

        turn_id = _first_started_turn_id(later_events)
        if turn_id is None:
            turn_id = command.session.active_turn_id
        if turn_id:
            command.status = AgentChatCommand.Status.COMPLETED
            command.result = {"turn_id": str(turn_id)}
            command.error = None
            command.save(
                update_fields=["status", "result", "error", "updated_at"]
            )
            reconciled += 1
            continue

        command.status = AgentChatCommand.Status.FAILED
        command.error = RESTART_DELIVERY_UNKNOWN
        command.save(update_fields=["status", "error", "updated_at"])
        append_event(
            agent_run_id=command.session_id,
            event_type="thread.message-failed",
            payload={
                "id": command.command_id,
                "role": "user",
                "phase": "backend_restart",
                "error": RESTART_DELIVERY_UNKNOWN,
                "deliveryUnknown": True,
                "retryable": False,
            },
        )
        reconciled += 1
    return reconciled


def _first_started_turn_id(events) -> str | None:
    for event in events:
        if event.event_type != "thread.turn-started":
            continue
        turn_id = event.payload.get("turnId")
        if turn_id is None:
            turn = event.payload.get("turn")
            turn_id = turn.get("id") if isinstance(turn, dict) else None
        if turn_id:
            return str(turn_id)
    return None
