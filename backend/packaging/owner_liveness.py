"""Desktop-owner liveness observation for the packaged backend."""

from __future__ import annotations

import contextlib
import fcntl
import os
import stat
import threading
from typing import Callable


class OwnerExited(BaseException):
    """Stop pre-serving startup after the desktop owner's pipe reaches EOF."""


class OwnerLiveness:
    """Observe one desktop owner's pipe with a single blocking read loop."""

    def __init__(self, descriptor: int):
        if descriptor < 3:
            raise ValueError("descriptor must not alias stdin, stdout, or stderr")
        try:
            status_flags = fcntl.fcntl(descriptor, fcntl.F_GETFL)
            descriptor_stat = os.fstat(descriptor)
        except OSError as exc:
            raise ValueError(f"descriptor {descriptor} is not open: {exc}") from exc
        if status_flags & os.O_ACCMODE != os.O_RDONLY:
            raise ValueError(f"descriptor {descriptor} is not a read end")
        if not stat.S_ISFIFO(descriptor_stat.st_mode):
            raise ValueError(f"descriptor {descriptor} is not a pipe")

        self.descriptor = descriptor
        self.owner_exited = threading.Event()
        self._closed = threading.Event()
        self._callback_lock = threading.Lock()
        self._shutdown_callback: Callable[[], None] | None = None
        self._watcher = threading.Thread(
            target=self._watch,
            name="desktop-owner-liveness",
            daemon=True,
        )

    def start(self) -> None:
        self._watcher.start()

    def _watch(self) -> None:
        try:
            while os.read(self.descriptor, 1):
                pass
        except OSError:
            if self._closed.is_set():
                return
            # A descriptor that becomes unreadable is no longer a valid owner
            # assertion. Treat it exactly like EOF rather than running detached.
        self.owner_exited.set()
        with self._callback_lock:
            callback = self._shutdown_callback
        if callback is not None:
            callback()

    def bind_shutdown(self, callback: Callable[[], None]) -> None:
        """Route EOF to the shutdown mechanism active in the current phase."""

        with self._callback_lock:
            self._shutdown_callback = callback
            owner_exited = self.owner_exited.is_set()
        if owner_exited:
            callback()

    def close(self) -> None:
        self._closed.set()
        with contextlib.suppress(OSError):
            os.close(self.descriptor)

    def __enter__(self) -> OwnerLiveness:
        self.start()
        return self

    def __exit__(self, *_exc_info) -> None:
        self.close()
