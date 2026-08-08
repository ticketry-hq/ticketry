"""Database executor owned by the persistent Chat runtime loop."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from typing import Any, TypeVar

from asgiref.sync import SyncToAsync, sync_to_async
from django.db import close_old_connections


T = TypeVar("T")

# A synchronous REST view can occupy asgiref's global thread-sensitive worker
# while it waits for ChatRuntimeSupervisor. Chat ORM work therefore needs a
# separate executor. One worker preserves the serialized database behavior the
# runtime previously obtained from ``thread_sensitive=True`` (and keeps the
# SQLite-backed test environment free of competing writers).
_CHAT_DATABASE_EXECUTOR = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="ticketry-chat-db",
)


def chat_database_sync_to_async(
    operation: Callable[..., T],
) -> SyncToAsync[Any, T]:
    """Run one isolated ORM operation without using asgiref's global worker."""

    @wraps(operation)
    def run(*args: Any, **kwargs: Any) -> T:
        try:
            return operation(*args, **kwargs)
        finally:
            close_old_connections()

    return sync_to_async(
        run,
        thread_sensitive=False,
        executor=_CHAT_DATABASE_EXECUTOR,
    )
