"""Durable normalized event log for structured Chat runs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.db import transaction

from apps.runs.chat.bus import publish_chat_event_sync
from apps.runs.chat.contracts import ChatEventRecord
from apps.runs.models import AgentChatEvent, AgentChatSession


@dataclass(frozen=True)
class AppendedChatEvent:
    """API-safe result of allocating and storing one run-local event."""

    sequence: int
    event_type: str
    payload: dict[str, Any]
    created_at: str


@transaction.atomic
def append_event(
    *,
    agent_run_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> AppendedChatEvent:
    """Append one event while allocating its reconnect cursor atomically."""

    if not event_type.strip():
        raise ValueError("event_type must be non-empty")

    session = AgentChatSession.objects.select_for_update().get(run_id=agent_run_id)
    sequence = session.next_sequence
    event = AgentChatEvent.objects.create(
        session=session,
        sequence=sequence,
        event_type=event_type,
        payload=payload,
    )
    session.next_sequence = sequence + 1
    session.save(update_fields=["next_sequence", "updated_at"])
    appended = AppendedChatEvent(
        sequence=sequence,
        event_type=event_type,
        payload=payload,
        created_at=event.created_at.isoformat(),
    )
    wire_event = ChatEventRecord(
        sequence=appended.sequence,
        event_type=appended.event_type,
        payload=appended.payload,
        created_at=appended.created_at,
    )
    transaction.on_commit(
        lambda: publish_chat_event_sync(
            agent_run_id=agent_run_id,
            event=wire_event,
        )
    )
    return appended


def replay_events(
    *,
    agent_run_id: str,
    after: int = 0,
    through: int | None = None,
) -> list[AppendedChatEvent]:
    """Return an ordered transcript interval ``after < sequence <= through``."""

    if after < 0:
        raise ValueError("after must be non-negative")
    if through is not None and through < 0:
        raise ValueError("through must be non-negative")
    rows = AgentChatEvent.objects.filter(
        session_id=agent_run_id,
        sequence__gt=after,
    )
    if through is not None:
        rows = rows.filter(sequence__lte=through)
    rows = rows.order_by("sequence")
    return [
        AppendedChatEvent(
            sequence=row.sequence,
            event_type=row.event_type,
            payload=row.payload,
            created_at=row.created_at.isoformat(),
        )
        for row in rows
    ]
