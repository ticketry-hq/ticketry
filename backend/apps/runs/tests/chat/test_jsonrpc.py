import asyncio
import errno
import json
import os
import signal
import sys
import textwrap
from pathlib import Path

import pytest

from apps.runs.chat.jsonrpc import (
    MAX_JSONRPC_FRAME_BYTES,
    JsonRpcProcessExited,
    JsonRpcProtocolError,
    JsonRpcRemoteError,
    JsonRpcServerRequestError,
    JsonRpcStdioClient,
    ServerRequestOperation,
    chat_watchdog_argv,
)


PEER = r"""
import json
import sys

for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get("method")
    if method == "echo":
        print(json.dumps({"id": frame["id"], "result": frame.get("params")}), flush=True)
    elif method == "fail":
        print(json.dumps({"id": frame["id"], "error": {"code": 42, "message": "nope", "data": {"retry": False, "apiKey": "private-api-key", "AWS_SECRET_ACCESS_KEY": "private-aws-key", "privateKey": "private-signing-key", "debug": "Authorization: Bearer private-debug", "context": "token=private-context", "nested": {"access_token": "private-token", "tokenUsage": {"inputTokens": 12}}}}}), flush=True)
    elif method == "large-response":
        print(json.dumps({"id": frame["id"], "result": {"text": "x" * 70000}}), flush=True)
    elif method == "oversized-response":
        print(json.dumps({"id": frame["id"], "result": {"text": "x" * (5 * 1024 * 1024)}}), flush=True)
    elif method == "with-notification":
        print(json.dumps({"method": "turn/started", "params": {"turnId": "turn-1"}}), flush=True)
        print(json.dumps({"id": frame["id"], "result": {"ok": True}}), flush=True)
    elif method == "with-server-request":
        print(json.dumps({"id": "approval-1", "method": "item/commandExecution/requestApproval", "params": {"command": "pytest"}}), flush=True)
        response = json.loads(sys.stdin.readline())
        print(json.dumps({"id": frame["id"], "result": response}), flush=True)
    elif method == "with-unsupported-server-request":
        print(json.dumps({"id": "unsupported-1", "method": "item/tool/call", "params": {}}), flush=True)
        response = json.loads(sys.stdin.readline())
        print(json.dumps({"id": frame["id"], "result": response}), flush=True)
    elif method == "server-request-then-resolved":
        print(json.dumps({"id": 73, "method": "item/commandExecution/requestApproval", "params": {"command": "pytest"}}), flush=True)
        print(json.dumps({"method": "serverRequest/resolved", "params": {"requestId": 73}}), flush=True)
        response = json.loads(sys.stdin.readline())
        print(json.dumps({"id": frame["id"], "result": response}), flush=True)
    elif method == "server-request-then-exit":
        print(json.dumps({"id": "pending-1", "method": "item/tool/requestUserInput", "params": {}}), flush=True)
        sys.exit(8)
    elif method == "spawn-descendant":
        import subprocess
        marker = frame["params"]["marker"]
        child_script = "import pathlib,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(1); pathlib.Path(sys.argv[1]).write_text('escaped')"
        child = subprocess.Popen(
            [sys.executable, "-c", child_script, marker],
            stdin=subprocess.DEVNULL,
        )
        print(json.dumps({"id": frame["id"], "result": {"pid": child.pid}}), flush=True)
    elif method == "malformed":
        print("{not-json", flush=True)
        import time
        time.sleep(10)
"""


async def start_peer(**handlers) -> JsonRpcStdioClient:
    return await JsonRpcStdioClient.start(
        [sys.executable, "-u", "-c", PEER],
        **handlers,
    )


def test_watchdog_argv_uses_absolute_source_and_frozen_multicall_entrypoints(
    monkeypatch,
):
    source = chat_watchdog_argv(
        death_fd=3,
        status_fd=4,
        cleanup_fd=5,
        app_server_argv=["codex", "app-server"],
    )
    assert source[0] == sys.executable
    assert Path(source[1]).is_absolute()
    assert source[1].endswith("backend/packaging/sidecar.py")
    assert source[2:] == [
        "chat-watchdog",
        "--death-fd",
        "3",
        "--status-fd",
        "4",
        "--cleanup-fd",
        "5",
        "--grace-seconds",
        "0.5",
        "--",
        "codex",
        "app-server",
    ]

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    frozen = chat_watchdog_argv(
        death_fd=3,
        status_fd=4,
        cleanup_fd=5,
        app_server_argv=["codex", "app-server"],
    )
    assert frozen[:2] == [sys.executable, "chat-watchdog"]


@pytest.mark.asyncio
async def test_request_round_trip_and_remote_error():
    client = await start_peer()
    try:
        assert await client.request("echo", {"hello": "world"}) == {"hello": "world"}
        with pytest.raises(JsonRpcRemoteError) as error:
            await client.request("fail")
        assert error.value.code == 42
        assert error.value.data == {
            "retry": False,
            "apiKey": "[REDACTED]",
            "AWS_SECRET_ACCESS_KEY": "[REDACTED]",
            "privateKey": "[REDACTED]",
            "debug": "Authorization: Bearer [REDACTED]",
            "context": "token=[REDACTED]",
            "nested": {
                "access_token": "[REDACTED]",
                "tokenUsage": {"inputTokens": 12},
            },
        }
        assert "private-api-key" not in str(error.value.data)
        assert "private-token" not in str(error.value.data)
        assert "private-debug" not in str(error.value.data)
        assert "private-context" not in str(error.value.data)
        assert "private-aws-key" not in str(error.value.data)
        assert "private-signing-key" not in str(error.value.data)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_large_jsonrpc_frame_above_asyncio_default_limit_is_supported():
    client = await start_peer()
    try:
        response = await client.request("large-response")
        assert len(response["text"]) == 70_000
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_jsonrpc_frame_limit_rejects_truly_oversized_peer_output():
    assert MAX_JSONRPC_FRAME_BYTES > 70_000
    client = await start_peer()
    try:
        with pytest.raises(JsonRpcProtocolError):
            await asyncio.wait_for(client.request("oversized-response"), timeout=3)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_notifications_are_delivered_in_order():
    received = []

    async def on_notification(method, params):
        received.append((method, params))

    client = await start_peer(on_notification=on_notification)
    try:
        assert await client.request("with-notification") == {"ok": True}
        assert received == [("turn/started", {"turnId": "turn-1"})]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_server_requests_are_answered_on_the_same_stream():
    async def on_request(request_id, method, params):
        assert request_id == "approval-1"
        assert method == "item/commandExecution/requestApproval"
        assert params == {"command": "pytest"}
        return {"decision": "accept"}

    client = await start_peer(on_request=on_request)
    try:
        response = await client.request("with-server-request")
        assert response == {"id": "approval-1", "result": {"decision": "accept"}}
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_typed_server_request_errors_preserve_explicit_jsonrpc_codes():
    async def on_request(request_id, method, _params):
        assert request_id == "unsupported-1"
        raise JsonRpcServerRequestError(-32601, f"Unsupported server request: {method}")

    client = await start_peer(on_request=on_request)
    try:
        response = await client.request("with-unsupported-server-request")
        assert response == {
            "id": "unsupported-1",
            "error": {
                "code": -32601,
                "message": "Unsupported server request: item/tool/call",
            },
        }
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_buffered_resolution_waits_for_server_request_durable_barrier():
    ordering: list[str] = []
    provider_resolution = asyncio.get_running_loop().create_future()

    def on_request(request_id, _method, _params):
        assert request_id == 73
        ready = asyncio.get_running_loop().create_future()

        async def result():
            await asyncio.sleep(0.05)
            ordering.append("requested")
            ready.set_result(None)
            return await provider_resolution

        return ServerRequestOperation(result=result(), ready=ready)

    async def on_notification(method, params):
        assert method == "serverRequest/resolved"
        assert params == {"requestId": 73}
        ordering.append("resolved")
        provider_resolution.set_result({"decision": "cancel"})

    client = await start_peer(
        on_request=on_request,
        on_notification=on_notification,
    )
    try:
        response = await client.request("server-request-then-resolved")
        assert response == {
            "id": 73,
            "result": {"decision": "cancel"},
        }
        assert ordering == ["requested", "resolved"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_process_exit_fails_an_in_flight_request():
    client = await JsonRpcStdioClient.start(
        [sys.executable, "-u", "-c", "import sys; sys.exit(7)"],
    )
    try:
        with pytest.raises(JsonRpcProcessExited, match="exited with code 7"):
            await asyncio.wait_for(client.request("never"), timeout=2)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_process_exit_cancels_pending_server_request_handlers():
    cancelled = asyncio.Event()

    async def on_request(_request_id, _method, _params):
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    client = await start_peer(on_request=on_request)
    try:
        with pytest.raises(JsonRpcProcessExited):
            await client.request("server-request-then-exit")
        assert await client.wait() == 8
        assert cancelled.is_set()
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "posix", reason="process-group containment is POSIX")
async def test_close_terminates_descendants_that_retain_app_server_stdio(tmp_path):
    marker = tmp_path / "escaped-child.txt"
    client = await start_peer()
    death_fd = client._watchdog_write_fd
    cleanup_fd = client._watchdog_cleanup_fd
    response = await client.request("spawn-descendant", {"marker": str(marker)})
    assert response["pid"] > 0

    await asyncio.wait_for(client.close(), timeout=3)
    await asyncio.sleep(0.75)

    assert not marker.exists()
    assert client._watchdog_write_fd is None
    assert client._watchdog_cleanup_fd is None
    for descriptor in (death_fd, cleanup_fd):
        assert descriptor is not None
        with pytest.raises(OSError) as closed:
            os.fstat(descriptor)
        assert closed.value.errno == errno.EBADF


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "posix", reason="process-group containment is POSIX")
async def test_close_falls_back_to_target_group_if_watchdog_is_killed(tmp_path):
    marker = tmp_path / "watchdog-killed-child.txt"
    client = await start_peer()
    response = await client.request("spawn-descendant", {"marker": str(marker)})
    assert response["pid"] > 0

    os.kill(client._process.pid, signal.SIGKILL)
    try:
        for _ in range(200):
            if client._process.returncode is not None:
                break
            await asyncio.sleep(0.01)
        assert client._process.returncode == -signal.SIGKILL
        await asyncio.wait_for(client.close(), timeout=4)
        await asyncio.sleep(0.75)

        assert client._watchdog_containment_confirmed is True
        assert not marker.exists()
    finally:
        if not client._closed:
            await asyncio.wait_for(client.close(), timeout=4)


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "posix", reason="process-group containment is POSIX")
async def test_backend_sigkill_triggers_external_watchdog_tree_containment(tmp_path):
    marker = tmp_path / "hard-crash-child.txt"
    backend_root = Path(__file__).resolve().parents[4]
    peer = r'''
import json
import signal
import subprocess
import sys

for line in sys.stdin:
    frame = json.loads(line)
    if frame.get("method") != "spawn":
        continue
    child_script = "import pathlib,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(1.2); pathlib.Path(sys.argv[1]).write_text('survived'); time.sleep(30)"
    child = subprocess.Popen([sys.executable, "-c", child_script, frame["params"]["marker"]])
    print(json.dumps({"id": frame["id"], "result": {"childPid": child.pid}}), flush=True)
'''
    helper_script = textwrap.dedent(
        f"""
        import asyncio
        import json
        import os
        import sys
        sys.path.insert(0, {str(backend_root)!r})
        from apps.runs.chat.jsonrpc import JsonRpcStdioClient

        PEER = {peer!r}

        async def main():
            client = await JsonRpcStdioClient.start(
                [sys.executable, "-u", "-c", PEER]
            )
            result = await client.request("spawn", {{"marker": {str(marker)!r}}})
            print(json.dumps({{
                "backendPid": os.getpid(),
                "watchdogPid": client._process.pid,
                "appPid": client.pid,
                "childPid": result["childPid"],
            }}), flush=True)
            await asyncio.Event().wait()

        asyncio.run(main())
        """
    )
    helper = await asyncio.create_subprocess_exec(
        sys.executable,
        "-u",
        "-c",
        helper_script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert helper.stdout is not None
    pids: dict[str, int] = {}
    try:
        ready = await asyncio.wait_for(helper.stdout.readline(), timeout=5)
        pids = json.loads(ready)
        assert pids["backendPid"] == helper.pid

        os.kill(helper.pid, signal.SIGKILL)
        await helper.wait()
        await asyncio.sleep(1.6)

        assert not marker.exists()
        for key in ("watchdogPid", "appPid", "childPid"):
            with pytest.raises(ProcessLookupError):
                os.kill(pids[key], 0)
    finally:
        if helper.returncode is None:
            helper.kill()
            await helper.wait()
        app_pid = pids.get("appPid")
        if app_pid:
            try:
                if os.getpgid(app_pid) == app_pid:
                    os.killpg(app_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


@pytest.mark.asyncio
async def test_close_failure_keeps_client_retryable(monkeypatch):
    client = await start_peer()
    original_stop = client._stop_owned_process
    attempts = 0

    async def flaky_stop():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("transient stop failure")
        await original_stop()

    monkeypatch.setattr(client, "_stop_owned_process", flaky_stop)

    with pytest.raises(RuntimeError, match="transient stop failure"):
        await client.close()
    assert client._closed is False
    assert client._closing is False

    await client.close()
    assert client._closed is True
    assert attempts == 2


@pytest.mark.asyncio
async def test_cancelled_close_retains_cleanup_confirmation_for_retry(monkeypatch):
    client = await start_peer()
    original_wait = client._wait_for_process_returncode
    wait_entered = asyncio.Event()

    async def blocked_wait(*, timeout=None):
        wait_entered.set()
        await asyncio.Future()

    monkeypatch.setattr(client, "_wait_for_process_returncode", blocked_wait)
    closing = asyncio.create_task(client.close())
    await wait_entered.wait()
    closing.cancel()
    with pytest.raises(asyncio.CancelledError):
        await closing

    assert client._closed is False
    assert client._watchdog_write_fd is None
    assert client._watchdog_cleanup_fd is not None

    monkeypatch.setattr(client, "_wait_for_process_returncode", original_wait)
    await asyncio.wait_for(client.close(), timeout=4)
    assert client._closed is True
    assert client._watchdog_containment_confirmed is True
    assert client._watchdog_cleanup_fd is None


@pytest.mark.asyncio
async def test_protocol_failure_terminates_a_peer_instead_of_hanging_requests():
    client = await start_peer()
    try:
        with pytest.raises(JsonRpcProtocolError, match="invalid JSON"):
            await asyncio.wait_for(client.request("malformed"), timeout=2)
        assert await asyncio.wait_for(client.wait(), timeout=2) != 0
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_process_stderr_is_redacted_and_bounded():
    secret = "correct horse battery staple"
    script = (
        "import sys; "
        f"sys.stderr.write('password={secret}; debug=' + 'x' * 5000); "
        "sys.stderr.flush(); sys.exit(9)"
    )
    client = await JsonRpcStdioClient.start([sys.executable, "-u", "-c", script])
    try:
        with pytest.raises(JsonRpcProcessExited) as error:
            await asyncio.wait_for(client.request("never"), timeout=2)
        assert secret not in str(error.value)
        assert "[REDACTED]" in str(error.value)
        assert len(str(error.value)) < 2_200
    finally:
        await client.close()
