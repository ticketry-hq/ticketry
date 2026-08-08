"""Consistent durable snapshot reads for Chat API and WebSocket clients."""

from __future__ import annotations

from apps.errors import ApplicationError
from apps.runs.chat.contracts import ChatSnapshotFrame


class ChatRunNotFound(LookupError):
    """No durable run exists for the requested id."""


class ChatCursorAhead(ValueError):
    """The client cursor is newer than the durable transcript."""


def load_chat_snapshot(*, agent_run_id: str, after: int = 0) -> ChatSnapshotFrame:
    """Validate the transport-neutral snapshot as the checked WS envelope."""

    if after < 0:
        raise ValueError("after must be non-negative")
    # Imported lazily so the application API can itself depend on the event
    # bus and checked event record without creating a module cycle.
    from apps.runs.chat.api import get_chat_snapshot

    try:
        payload = get_chat_snapshot(agent_run_id, after=after)
    except ApplicationError as exc:
        if exc.code == "chat_not_found":
            raise ChatRunNotFound(agent_run_id) from exc
        if exc.code == "chat_cursor_ahead":
            raise ChatCursorAhead(str(exc)) from exc
        raise
    if after > payload["cursor"]:
        raise ChatCursorAhead(
            f"cursor {after} is ahead of transcript {payload['cursor']}"
        )
    return ChatSnapshotFrame.model_validate(
        {
            "agent_run_id": agent_run_id,
            **payload,
        }
    )
