"""Persistent event-loop ownership for long-lived Chat subprocess runtimes.

Django REST views are synchronous and ``async_to_sync`` may create a temporary
loop per call. A Codex app-server process, its reader tasks, and asyncio Futures
must instead remain on one loop for their full lifetime. This supervisor owns
that loop on a dedicated backend thread and provides sync and async submission
seams for REST and Channels respectively.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Awaitable, Callable
from concurrent.futures import Future
from typing import TypeVar

from apps.runs.chat.codex_runtime import runtime_registry

T = TypeVar("T")
logger = logging.getLogger(__name__)


class ChatRuntimeSupervisor:
    """Own a persistent asyncio loop and every live Chat runtime on it."""

    def __init__(self):
        self._state_lock = threading.Lock()
        self._ready = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start once; safe for ASGI startup and lazy REST initialization."""

        with self._state_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._ready.clear()
            thread = threading.Thread(
                target=self._run_loop,
                name="ticketry-chat-runtime",
                daemon=True,
            )
            self._thread = thread
            thread.start()
        if not self._ready.wait(timeout=5):
            raise RuntimeError("Chat runtime event loop did not start")

    def submit(self, operation: Callable[[], Awaitable[T]]) -> Future[T]:
        """Schedule a coroutine factory without constructing it on the wrong loop."""

        self.start()
        with self._state_lock:
            loop = self._loop
        if loop is None or loop.is_closed():
            raise RuntimeError("Chat runtime event loop is unavailable")
        return asyncio.run_coroutine_threadsafe(operation(), loop)

    def call_sync(
        self,
        operation: Callable[[], Awaitable[T]],
        *,
        timeout: float | None = 30,
    ) -> T:
        """Run an operation and contain cancellation when its deadline expires."""

        completed = threading.Event()

        async def tracked_operation() -> T:
            try:
                return await operation()
            finally:
                completed.set()

        future = self.submit(tracked_operation)
        try:
            return future.result(timeout=timeout)
        except TimeoutError:
            if future.done():
                raise
            # ``Future.result`` does not cancel run_coroutine_threadsafe work.
            # Explicit cancellation plus a bounded completion wait lets launch
            # coroutines unwind their process/row/artifact cleanup before the
            # REST seam reports the timeout.
            future.cancel()
            if not completed.wait(timeout=5):
                logger.error(
                    "timed-out Chat runtime operation did not finish cancellation"
                )
            raise TimeoutError("Chat runtime operation timed out") from None

    async def call(self, operation: Callable[[], Awaitable[T]]) -> T:
        """Run an operation from an ASGI/Channels event loop."""

        return await asyncio.wrap_future(self.submit(operation))

    def stop(self) -> None:
        """Close every runtime and join the owned thread during ASGI shutdown."""

        with self._state_lock:
            loop = self._loop
            thread = self._thread
        if loop is None or thread is None:
            return
        if threading.current_thread() is thread:
            raise RuntimeError("Chat runtime supervisor cannot stop itself")
        if not loop.is_closed():
            asyncio.run_coroutine_threadsafe(runtime_registry.close_all(), loop).result(
                timeout=15
            )
            loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)
        if thread.is_alive():
            raise RuntimeError("Chat runtime event loop did not stop")
        with self._state_lock:
            self._loop = None
            self._thread = None

    @property
    def running(self) -> bool:
        with self._state_lock:
            return bool(self._thread and self._thread.is_alive() and self._loop)

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        with self._state_lock:
            self._loop = loop
        self._ready.set()
        try:
            loop.run_forever()
        finally:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.run_until_complete(loop.shutdown_default_executor())
            loop.close()


runtime_supervisor = ChatRuntimeSupervisor()
