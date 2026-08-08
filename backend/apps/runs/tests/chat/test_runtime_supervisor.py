import asyncio
import threading

import pytest

from apps.runs.chat.runtime_supervisor import ChatRuntimeSupervisor


def test_sync_calls_share_one_persistent_owned_loop():
    supervisor = ChatRuntimeSupervisor()

    async def identity():
        return id(asyncio.get_running_loop()), threading.current_thread().name

    try:
        first = supervisor.call_sync(identity)
        second = supervisor.call_sync(identity)
        assert first == second
        assert first[1] == "ticketry-chat-runtime"
    finally:
        supervisor.stop()


def test_sync_timeout_cancels_and_waits_for_operation_cleanup():
    supervisor = ChatRuntimeSupervisor()
    cancelled = threading.Event()
    cleaned_up = threading.Event()

    async def slow_operation():
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            cancelled.set()
            await asyncio.sleep(0.01)
            raise
        finally:
            cleaned_up.set()

    try:
        with pytest.raises(TimeoutError, match="operation timed out"):
            supervisor.call_sync(slow_operation, timeout=0.01)
        assert cancelled.is_set()
        assert cleaned_up.is_set()
    finally:
        supervisor.stop()


@pytest.mark.asyncio
async def test_async_call_marshals_off_the_channels_loop():
    supervisor = ChatRuntimeSupervisor()
    caller_loop = id(asyncio.get_running_loop())

    async def owned_loop_id():
        return id(asyncio.get_running_loop())

    try:
        assert await supervisor.call(owned_loop_id) != caller_loop
    finally:
        supervisor.stop()
