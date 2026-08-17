"""Behavior tests for transport-independent browser viewer attachments."""

from __future__ import annotations

import ast
import asyncio
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from apps.terminals.consumers import TerminalConsumer
from apps.terminals.runtime import TerminalDimensions
from apps.terminals import viewer_attachments


class RecordingAttachment:
    def __init__(self, output: list[bytes] | None = None) -> None:
        self.output: queue.Queue[bytes | None] = queue.Queue()
        for chunk in output or []:
            self.output.put(chunk)
        self.writes: list[bytes] = []
        self.resizes: list[TerminalDimensions] = []
        self.scrolls: list[tuple[str, int]] = []
        self.detached = False

    def read(self, size: int = 4096) -> bytes:
        del size
        chunk = self.output.get(timeout=2)
        if chunk is None:
            return b""
        return chunk

    def write(self, data: bytes) -> None:
        self.writes.append(data)

    def resize(self, dimensions: TerminalDimensions) -> None:
        self.resizes.append(dimensions)

    def scroll(self, direction: str, lines: int = 3) -> None:
        self.scrolls.append((direction, lines))

    @property
    def completed(self) -> bool:
        return self.detached

    def wait(self) -> int | None:
        return None

    def detach(self) -> None:
        self.detached = True
        self.output.put(None)


class RecordingViewer:
    def __init__(
        self, attachment: RecordingAttachment, agent_run_id: str = "run-1"
    ) -> None:
        self.attachment = attachment
        self.agent_run_id = agent_run_id
        self.released = False

    def release(self) -> None:
        self.released = True
        self.attachment.detach()


def _consumer():
    consumer = TerminalConsumer()
    consumer._incoming = asyncio.Queue()
    sent: list[tuple[str, object]] = []

    async def send(*, text_data=None, bytes_data=None, close=False):
        del close
        if text_data is not None:
            sent.append(("text", text_data))
        if bytes_data is not None:
            sent.append(("bytes", bytes_data))

    async def close(*, code=None):
        sent.append(("close", code))

    consumer.send = send
    consumer.close = close
    return consumer, sent


@pytest.mark.asyncio
async def test_attachment_eof_closes_viewer_without_run_reconciliation() -> None:
    attachment = RecordingAttachment([b"ready", b""])
    viewer = RecordingViewer(attachment)
    consumer, sent = _consumer()

    await consumer._pump(viewer)

    assert ("bytes", b"ready") in sent
    assert ("close", 1000) in sent
    assert viewer.released is True
    assert attachment.detached is True


@pytest.mark.asyncio
async def test_disconnect_cleanup_cancels_pumps_and_routes_raw_controls() -> None:
    attachment = RecordingAttachment()
    viewer = RecordingViewer(attachment)
    consumer, _ = _consumer()
    pump = asyncio.create_task(consumer._pump(viewer))

    await consumer._incoming.put({"bytes": b"raw-input", "text": None})
    await consumer._incoming.put(
        {"bytes": None, "text": '{"type":"resize","cols":120,"rows":40}'}
    )
    await consumer._incoming.put(
        {"bytes": None, "text": '{"type":"scroll","dir":"up","lines":5}'}
    )
    for _ in range(20):
        if attachment.scrolls:
            break
        await asyncio.sleep(0.01)

    pump.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pump

    assert attachment.writes == [b"raw-input"]
    assert attachment.resizes == [TerminalDimensions(120, 40)]
    assert attachment.scrolls == [("up", 5)]
    assert viewer.released is True


def test_websocket_adapter_imports_no_pty_or_tmux_implementation() -> None:
    source = (Path(__file__).parents[1] / "consumers.py").read_text()
    imports = {
        alias.name
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        node.module or ""
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ImportFrom)
    }

    assert "ptyprocess" not in imports
    assert not any("apps.terminals.tmux" in name for name in imports)
    assert "apps.terminals.session_registry" not in imports


def test_outside_policy_replaces_only_the_transient_viewer(monkeypatch) -> None:
    class Runtime:
        def __init__(self) -> None:
            self.attachments: list[RecordingAttachment] = []

        def attach(self, agent_run_id: str) -> RecordingAttachment:
            assert agent_run_id == "run-1"
            attachment = RecordingAttachment()
            self.attachments.append(attachment)
            return attachment

    runtime = Runtime()
    leases: list[tuple[str, str]] = []
    releases: list[tuple[str, str]] = []
    monkeypatch.setattr(
        viewer_attachments.viewer_leases,
        "acquire",
        lambda **kwargs: leases.append(
            (kwargs["agent_run_id"], kwargs["viewer_id"])
        ),
    )
    monkeypatch.setattr(
        viewer_attachments.viewer_leases,
        "renew",
        lambda **kwargs: object(),
    )
    monkeypatch.setattr(
        viewer_attachments.viewer_leases,
        "release",
        lambda **kwargs: releases.append(
            (kwargs["agent_run_id"], kwargs["viewer_id"])
        ),
    )
    previous_runtime = viewer_attachments._runtime
    viewer_attachments.clear()
    viewer_attachments.configure_runtime(runtime)
    try:
        first = viewer_attachments.acquire(
            agent_run_id="run-1",
            viewer_id="browser-1",
            dimensions=TerminalDimensions(80, 24),
        )
        second = viewer_attachments.acquire(
            agent_run_id="run-1",
            viewer_id="browser-2",
            dimensions=TerminalDimensions(100, 30),
        )

        assert first.attachment.detached is True
        assert second.attachment.detached is False
        assert viewer_attachments.renew(first) is False
        assert viewer_attachments.renew(second) is True
        assert viewer_attachments.active_count() == 1
        assert leases == [("run-1", "browser-1"), ("run-1", "browser-2")]

        retried = viewer_attachments.acquire(
            agent_run_id="run-1",
            viewer_id="browser-2",
            dimensions=TerminalDimensions(100, 30),
        )
        assert second.attachment.detached is True
        assert viewer_attachments.renew(second) is False
        assert viewer_attachments.renew(retried) is True

        retried.release()
        assert retried.attachment.detached is True
        assert viewer_attachments.active_count() == 0
        assert releases == [("run-1", "browser-1"), ("run-1", "browser-2")]
    finally:
        viewer_attachments.clear()
        viewer_attachments.configure_runtime(previous_runtime)


def test_concurrent_acquisitions_serialize_lease_and_active_replacement(
    monkeypatch,
) -> None:
    class Runtime:
        def __init__(self) -> None:
            self.attachments: dict[str, RecordingAttachment] = {}

        def attach(self, agent_run_id: str) -> RecordingAttachment:
            assert agent_run_id == "run-1"
            attachment = RecordingAttachment()
            self.attachments[threading.current_thread().name] = attachment
            return attachment

    runtime = Runtime()
    durable_owner: str | None = None
    durable_lock = threading.Lock()
    first_acquired = threading.Event()

    def acquire_lease(**kwargs) -> object:
        nonlocal durable_owner
        viewer_id = kwargs["viewer_id"]
        with durable_lock:
            durable_owner = viewer_id
        if viewer_id == "browser-a":
            first_acquired.set()
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                active = viewer_attachments._active.get("run-1")
                if active is not None and active.viewer_id == "browser-b":
                    break
                time.sleep(0.001)
        return object()

    def renew_lease(**kwargs) -> object | None:
        with durable_lock:
            return object() if durable_owner == kwargs["viewer_id"] else None

    def release_lease(**kwargs) -> bool:
        nonlocal durable_owner
        with durable_lock:
            if durable_owner != kwargs["viewer_id"]:
                return False
            durable_owner = None
            return True

    monkeypatch.setattr(viewer_attachments.viewer_leases, "acquire", acquire_lease)
    monkeypatch.setattr(viewer_attachments.viewer_leases, "renew", renew_lease)
    monkeypatch.setattr(viewer_attachments.viewer_leases, "release", release_lease)
    previous_runtime = viewer_attachments._runtime
    viewer_attachments.clear()
    viewer_attachments.configure_runtime(runtime)
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="viewer") as pool:
            first_future = pool.submit(
                viewer_attachments.acquire,
                agent_run_id="run-1",
                viewer_id="browser-a",
                dimensions=TerminalDimensions(80, 24),
            )
            assert first_acquired.wait(timeout=1)
            second_future = pool.submit(
                viewer_attachments.acquire,
                agent_run_id="run-1",
                viewer_id="browser-b",
                dimensions=TerminalDimensions(100, 30),
            )
            first = first_future.result(timeout=2)
            second = second_future.result(timeout=2)

        assert first.attachment.detached is True
        assert second.attachment.detached is False
        assert viewer_attachments.renew(first) is False
        assert viewer_attachments.renew(second) is True
        assert durable_owner == "browser-b"
        assert viewer_attachments.active_count() == 1
    finally:
        viewer_attachments.clear()
        viewer_attachments.configure_runtime(previous_runtime)
