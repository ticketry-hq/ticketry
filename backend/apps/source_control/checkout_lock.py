"""One writer at a time per checkout (T3 audit, hygiene item: serialization).

A working tree is a single shared mutable resource: two commits running in it
at once interleave ``git add`` and ``git commit`` and produce a commit neither
caller asked for. Every mutation therefore holds this app's lock for its own
checkout while it runs.

The lock is keyed by the checkout's real path, so two different checkouts —
two task worktrees, or a worktree and its module's base checkout — never wait
on each other. It is a process-local lock, which is the boundary that matters:
the backend is one process, and a *second* Ticketry against the same folder is
already outside what any in-process lock could promise.
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Iterator


#: One lock per checkout path, created on first use and then kept.
_locks: dict[str, threading.Lock] = {}

#: Guards the registry itself, never a git command.
_registry = threading.Lock()


def _lock_for(path: str) -> threading.Lock:
    key = os.path.realpath(path)
    with _registry:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _locks[key] = lock
        return lock


@contextmanager
def serialized(path: str) -> Iterator[None]:
    """Hold this checkout's write lock for the body of the block."""

    lock = _lock_for(path)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
