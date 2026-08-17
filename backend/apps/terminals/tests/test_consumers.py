"""WebSocket acceptance tests against the public attachment contract."""

from __future__ import annotations

import asyncio
import json
import queue

import pytest
from channels.testing.websocket import WebsocketCommunicator

from apps.runs.models import AgentRun
from apps.terminals import viewer_attachments
from apps.terminals.runtime import TerminalDimensions, TerminalNotFound
from studio_server.asgi import application
from worktracker.tests.factories import ensure_issue


pytestmark = pytest.mark.django_db(transaction=True)


class Attachment:
    def __init__(self, output: tuple[bytes, ...] = (b"ready\r\n", b"")) -> None:
        self.output: queue.Queue[bytes] = queue.Queue()
        for chunk in output:
            self.output.put(chunk)
        self.detached = False

    def read(self, size: int = 4096) -> bytes:
        del size
        return self.output.get(timeout=2)

    def write(self, data: bytes) -> None:
        del data

    def resize(self, dimensions: TerminalDimensions) -> None:
        del dimensions

    def scroll(self, direction: str, lines: int = 3) -> None:
        del direction, lines

    @property
    def completed(self) -> bool:
        return self.detached

    def wait(self) -> int | None:
        return None

    def detach(self) -> None:
        self.detached = True


class Viewer:
    def __init__(
        self, attachment: Attachment, agent_run_id: str = "run-attach"
    ) -> None:
        self.attachment = attachment
        self.agent_run_id = agent_run_id
        self.released = False

    def release(self) -> None:
        self.released = True
        self.attachment.detach()


def _attach_frame(agent_run_id: str = "run-attach") -> str:
    return json.dumps(
        {
            "type": "init",
            "mode": "attach",
            "agent_run_id": agent_run_id,
            "cols": 90,
            "rows": 28,
        }
    )


@pytest.mark.asyncio
async def test_attach_streams_raw_output_and_detaches_viewer(monkeypatch):
    attachment = Attachment()
    viewer = Viewer(attachment)
    captured: dict[str, object] = {}

    def acquire(**kwargs):
        captured.update(kwargs)
        return viewer

    monkeypatch.setattr(viewer_attachments, "acquire", acquire)
    communicator = WebsocketCommunicator(application, "/ws/terminal")
    connected, _ = await communicator.connect()
    assert connected
    await communicator.send_to(text_data=_attach_frame())

    ready = json.loads(await communicator.receive_from(timeout=2))
    assert ready["type"] == "ready"
    assert ready["agent_run_id"] == "run-attach"
    assert await communicator.receive_from(timeout=2) == b"ready\r\n"
    await communicator.wait(timeout=2)

    assert captured["agent_run_id"] == "run-attach"
    assert captured["dimensions"] == TerminalDimensions(90, 28)
    assert viewer.released is True
    assert attachment.detached is True


@pytest.mark.asyncio
async def test_missing_runtime_is_a_stable_attach_error(monkeypatch):
    def missing(**kwargs):
        raise TerminalNotFound(str(kwargs["agent_run_id"]))

    monkeypatch.setattr(viewer_attachments, "acquire", missing)
    communicator = WebsocketCommunicator(application, "/ws/terminal")
    connected, _ = await communicator.connect()
    assert connected
    await communicator.send_to(text_data=_attach_frame("missing"))

    assert json.loads(await communicator.receive_from(timeout=2)) == {
        "type": "error",
        "message": "session_not_found",
    }
    await communicator.wait(timeout=2)


@pytest.mark.asyncio
async def test_ended_runtime_is_a_graceful_attach_outcome(monkeypatch):
    issue = await asyncio.to_thread(
        ensure_issue,
        project_id="project-1",
        module_id="module-1",
        task_id="task-1",
    )
    await AgentRun.objects.acreate(
        id="ended-run",
        issue=issue,
        agent="codex",
        status="terminated",
        started_at="2026-08-15T10:00:00+00:00",
        ended_at="2026-08-15T10:30:00+00:00",
        scope="task",
    )

    def missing(**kwargs):
        raise TerminalNotFound(str(kwargs["agent_run_id"]))

    monkeypatch.setattr(viewer_attachments, "acquire", missing)
    communicator = WebsocketCommunicator(application, "/ws/terminal")
    connected, _ = await communicator.connect()
    assert connected
    await communicator.send_to(text_data=_attach_frame("ended-run"))

    assert json.loads(await communicator.receive_from(timeout=2)) == {
        "type": "error",
        "message": "session_ended",
    }
    await communicator.wait(timeout=2)


@pytest.mark.asyncio
async def test_bad_init_closes_without_touching_attachment_policy(monkeypatch):
    monkeypatch.setattr(
        viewer_attachments,
        "acquire",
        lambda **kwargs: pytest.fail(f"unexpected acquire: {kwargs}"),
    )
    communicator = WebsocketCommunicator(application, "/ws/terminal")
    connected, _ = await communicator.connect()
    assert connected
    await communicator.send_to(text_data="not json")

    assert json.loads(await communicator.receive_from(timeout=2)) == {
        "type": "error",
        "message": "bad_init",
    }
    await communicator.wait(timeout=2)
