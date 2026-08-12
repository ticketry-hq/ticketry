"""Project status WebSocket consumer."""

from urllib.parse import parse_qs

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from asgiref.sync import sync_to_async

from apps.runs.api import agent_status
from apps.runs.bus import STATUS_GROUP_FMT
from apps.runs.projections import project_work_item_replay, project_workflow_states
from studio_server.contracts import (
    StatusCursorFrame,
    StatusSnapshotFrame,
)


class StatusStreamConsumer(AsyncJsonWebsocketConsumer):
    """Project-scoped, receive-only v1 agent status stream."""

    async def connect(self) -> None:
        self._disconnected = False
        params = parse_qs(self.scope["query_string"].decode())
        project_id = params.get("project_id", [None])[0]
        if not project_id:
            await self.close()
            return
        try:
            cursor = _cursor_param(params)
        except ValueError:
            await self.close()
            return

        self.project_id = project_id
        await self.channel_layer.group_add(
            STATUS_GROUP_FMT.format(project_id=project_id), self.channel_name
        )
        await self.accept()
        upper, replay = await sync_to_async(
            project_work_item_replay, thread_sensitive=True
        )(project_id, cursor)
        # The shared snapshot builder stamps ``at`` before it reads the run
        # rows. Clients treat any known run the snapshot omits as exited
        # unless the run is newer than ``at``, so a run inserted while the
        # rows are being read must sort after the stamp, never before it.
        snapshot = await agent_status(project_id)
        frame = StatusSnapshotFrame(
            scope=snapshot.scope,
            runs=snapshot.runs,
            automation_attempts=snapshot.automation_attempts,
            at=snapshot.at,
            work_item_cursor=upper if cursor is None else cursor,
            workflow_states=await sync_to_async(
                project_workflow_states, thread_sensitive=True
            )(project_id),
        )
        await self.send_json(frame.model_dump())
        if cursor is not None:
            for projection in replay:
                await self.send_json(projection.model_dump())
            await self.send_json(
                StatusCursorFrame(project_id=project_id, revision=upper).model_dump()
            )

    async def status_frame(self, event: dict) -> None:
        # Channel-layer messages already queued for this consumer may be
        # dispatched immediately after the peer disconnects. ASGI forbids a
        # websocket.send after websocket.close, so discard that stale frame;
        # the reconnect snapshot/replay is authoritative for the new socket.
        if getattr(self, "_disconnected", False):
            return
        await self.send_json(event["frame"])

    async def receive(self, text_data=None, bytes_data=None) -> None:
        """Ignore client data; this feed is receive-only."""

    async def disconnect(self, code: int) -> None:
        self._disconnected = True
        project_id = getattr(self, "project_id", None)
        if project_id:
            await self.channel_layer.group_discard(
                STATUS_GROUP_FMT.format(project_id=project_id), self.channel_name
            )


def _cursor_param(params: dict[str, list[str]]) -> int | None:
    raw = params.get("cursor", [None])[0]
    if raw is None:
        return None
    cursor = int(raw)
    if cursor < 0:
        raise ValueError("cursor must be non-negative")
    return cursor
