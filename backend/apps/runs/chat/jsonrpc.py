"""Async newline-delimited JSON-RPC client for ``codex app-server``.

Codex omits the conventional ``jsonrpc: \"2.0\"`` field on the wire. The
client deliberately keeps the remaining JSON-RPC semantics: correlated
requests, notifications, server-initiated requests, structured errors, and
failure of pending requests when the subprocess exits.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import select
import signal
import sys
from collections import deque
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from apps.runs.chat.safety import (
    MAX_DIAGNOSTIC_CHARS,
    MAX_STDERR_LINE_CHARS,
    sanitize_error_payload,
    sanitize_external_message,
)

logger = logging.getLogger(__name__)

MAX_JSONRPC_FRAME_BYTES = 4 * 1024 * 1024
PROCESS_TERMINATE_GRACE_SECONDS = 0.5
WATCHDOG_START_TIMEOUT_SECONDS = 5.0
WATCHDOG_STOP_TIMEOUT_SECONDS = 3.0

JsonObject = dict[str, Any]
NotificationHandler = Callable[[str, Any], Awaitable[None] | None]
ServerRequestHandler = Callable[[int | str, str, Any], Awaitable[Any] | Any]


@dataclass(frozen=True)
class ServerRequestOperation:
    """A long-lived server response plus its short durable-registration barrier."""

    result: Awaitable[Any]
    ready: Awaitable[None]

    def __await__(self):
        """Keep the wrapper convenient for direct runtime-level callers."""

        return self.result.__await__()


def chat_watchdog_argv(
    *,
    death_fd: int,
    status_fd: int,
    cleanup_fd: int,
    app_server_argv: Sequence[str],
) -> list[str]:
    """Build the source/frozen multi-call watchdog command."""

    if getattr(sys, "frozen", False):
        entrypoint = [sys.executable]
    else:
        sidecar_path = Path(__file__).resolve().parents[3] / "packaging" / "sidecar.py"
        entrypoint = [sys.executable, str(sidecar_path)]
    return [
        *entrypoint,
        "chat-watchdog",
        "--death-fd",
        str(death_fd),
        "--status-fd",
        str(status_fd),
        "--cleanup-fd",
        str(cleanup_fd),
        "--grace-seconds",
        str(PROCESS_TERMINATE_GRACE_SECONDS),
        "--",
        *app_server_argv,
    ]


def _read_watchdog_status(status_fd: int) -> int:
    try:
        readable, _, _ = select.select(
            [status_fd],
            [],
            [],
            WATCHDOG_START_TIMEOUT_SECONDS,
        )
        if not readable:
            raise TimeoutError("Chat watchdog startup timed out")
        raw_status = os.read(status_fd, 4096)
    finally:
        os.close(status_fd)
    if not raw_status:
        raise RuntimeError("Chat watchdog exited before reporting app-server pid")
    raw_status = raw_status.splitlines()[0]
    try:
        status = json.loads(raw_status)
        process_group_id = int(status["pid"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError("Chat watchdog reported invalid startup status") from exc
    if process_group_id <= 0:
        raise RuntimeError("Chat watchdog reported invalid app-server pid")
    return process_group_id


def _read_watchdog_cleanup(cleanup_fd: int) -> None:
    try:
        confirmation = os.read(cleanup_fd, 64)
    finally:
        os.close(cleanup_fd)
    if confirmation != b"contained\n":
        raise JsonRpcContainmentError(
            "Chat watchdog exited without confirming process-tree containment"
        )


class JsonRpcClientError(Exception):
    """Base class for app-server transport failures."""


class JsonRpcRemoteError(JsonRpcClientError):
    """A correlated JSON-RPC request failed on the remote peer."""

    def __init__(self, code: int, message: str, data: Any = None):
        safe_message = sanitize_external_message(message)
        super().__init__(f"JSON-RPC error {code}: {safe_message}")
        self.code = code
        self.message = safe_message
        self.data = sanitize_error_payload(data)


class JsonRpcProtocolError(JsonRpcClientError):
    """The peer emitted a frame that is not a valid protocol object."""


class JsonRpcServerRequestError(JsonRpcClientError):
    """A server-initiated request is unsupported or has invalid parameters."""

    def __init__(self, code: int, message: str, data: Any = None):
        self.code = code
        self.message = sanitize_external_message(message)
        self.data = data
        super().__init__(self.message)


class JsonRpcProcessExited(JsonRpcClientError):
    """The managed app-server exited while the client was active."""

    def __init__(self, returncode: int | None, stderr_tail: Sequence[str] = ()):
        safe_tail = tuple(
            sanitize_external_message(line, max_chars=MAX_STDERR_LINE_CHARS)
            for line in stderr_tail
        )
        detail = sanitize_external_message(
            "\n".join(safe_tail).strip(),
            max_chars=MAX_DIAGNOSTIC_CHARS,
        )
        message = f"app-server exited with code {returncode}"
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)
        self.returncode = returncode
        self.stderr_tail = safe_tail


class JsonRpcContainmentError(JsonRpcClientError):
    """The lifetime anchor did not confirm full process-tree containment."""


class JsonRpcStdioClient:
    """Own one app-server subprocess and multiplex its stdio protocol."""

    def __init__(
        self,
        process: asyncio.subprocess.Process,
        *,
        on_notification: NotificationHandler | None = None,
        on_request: ServerRequestHandler | None = None,
        process_group_id: int | None = None,
        watchdog_write_fd: int | None = None,
        watchdog_cleanup_fd: int | None = None,
    ):
        if process.stdin is None or process.stdout is None:
            raise ValueError("app-server process must use stdin/stdout pipes")
        self._process = process
        self._stdin = process.stdin
        self._stdout = process.stdout
        self._stderr = process.stderr
        self._on_notification = on_notification
        self._on_request = on_request
        self._next_id = 1
        self._pending: dict[int | str, asyncio.Future[Any]] = {}
        self._write_lock = asyncio.Lock()
        self._stderr_tail: deque[str] = deque(maxlen=20)
        self._server_request_tasks: set[asyncio.Task[None]] = set()
        self._process_group_id = process_group_id
        self._watchdog_write_fd = watchdog_write_fd
        self._watchdog_cleanup_fd = watchdog_cleanup_fd
        self._watchdog_managed = watchdog_write_fd is not None
        self._watchdog_containment_confirmed = False
        self._process_stop_lock = asyncio.Lock()
        self._close_lock = asyncio.Lock()
        self._closing = False
        self._closed = False
        self._reader_task = asyncio.create_task(self._read_loop())
        self._stderr_task = (
            asyncio.create_task(self._drain_stderr()) if self._stderr is not None else None
        )

    @classmethod
    async def start(
        cls,
        argv: Sequence[str],
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        on_notification: NotificationHandler | None = None,
        on_request: ServerRequestHandler | None = None,
    ) -> "JsonRpcStdioClient":
        """Spawn an argv-only peer; shell interpretation is never involved."""

        if not argv:
            raise ValueError("argv must not be empty")
        process_group_id: int | None = None
        watchdog_write_fd: int | None = None
        watchdog_cleanup_fd: int | None = None
        owned_fds: set[int] = set()
        launch_argv = list(argv)
        process_options: dict[str, Any] = {}
        status_read_fd: int | None = None
        if os.name == "posix":
            # Spawn the lifetime anchor first. It creates and owns the actual
            # app-server process group, so backend SIGKILL closes the death
            # pipe and still leaves an external process able to TERM→KILL every
            # tool descendant. This also avoids persisting/reusing a raw PGID.
            death_read_fd, watchdog_write_fd = os.pipe()
            status_read_fd, status_write_fd = os.pipe()
            watchdog_cleanup_fd, cleanup_write_fd = os.pipe()
            owned_fds.update(
                {
                    death_read_fd,
                    watchdog_write_fd,
                    status_read_fd,
                    status_write_fd,
                    watchdog_cleanup_fd,
                    cleanup_write_fd,
                }
            )
            launch_argv = chat_watchdog_argv(
                death_fd=death_read_fd,
                status_fd=status_write_fd,
                cleanup_fd=cleanup_write_fd,
                app_server_argv=argv,
            )
            process_options.update(
                pass_fds=(death_read_fd, status_write_fd, cleanup_write_fd),
                start_new_session=True,
            )
        try:
            process = await asyncio.create_subprocess_exec(
                *launch_argv,
                cwd=cwd,
                env=dict(env) if env is not None else None,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=MAX_JSONRPC_FRAME_BYTES,
                **process_options,
            )
        except BaseException:
            for descriptor in owned_fds:
                os.close(descriptor)
            raise
        if os.name == "posix":
            assert status_read_fd is not None
            assert watchdog_write_fd is not None
            os.close(death_read_fd)
            owned_fds.discard(death_read_fd)
            os.close(status_write_fd)
            owned_fds.discard(status_write_fd)
            os.close(cleanup_write_fd)
            owned_fds.discard(cleanup_write_fd)
            try:
                process_group_id = await asyncio.to_thread(
                    _read_watchdog_status,
                    status_read_fd,
                )
                owned_fds.discard(status_read_fd)
            except BaseException:
                owned_fds.discard(status_read_fd)
                os.close(watchdog_write_fd)
                owned_fds.discard(watchdog_write_fd)
                wrapper_stopped = False
                try:
                    await asyncio.wait_for(
                        process.wait(),
                        timeout=WATCHDOG_STOP_TIMEOUT_SECONDS,
                    )
                    wrapper_stopped = True
                except TimeoutError:
                    # Do not discard or kill a stuck watchdog here: without a
                    # trustworthy target PID that could orphan its process
                    # group. Surface startup failure while the lifetime anchor
                    # still owns cleanup through the already-closed death pipe.
                    pass
                if watchdog_cleanup_fd is not None:
                    owned_fds.discard(watchdog_cleanup_fd)
                    if wrapper_stopped:
                        _read_watchdog_cleanup(watchdog_cleanup_fd)
                    else:
                        os.close(watchdog_cleanup_fd)
                raise
        return cls(
            process,
            on_notification=on_notification,
            on_request=on_request,
            process_group_id=process_group_id,
            watchdog_write_fd=watchdog_write_fd,
            watchdog_cleanup_fd=watchdog_cleanup_fd,
        )

    @property
    def pid(self) -> int | None:
        return self._process_group_id or self._process.pid

    async def request(self, method: str, params: Any = None) -> Any:
        """Send a request and await its correlated result."""

        if self._closed or self._process.returncode is not None:
            raise JsonRpcProcessExited(self._process.returncode, self._stderr_tail)
        request_id = self._next_id
        self._next_id += 1
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        frame: JsonObject = {"id": request_id, "method": method}
        if params is not None:
            frame["params"] = params
        try:
            await self._send(frame)
            return await future
        finally:
            self._pending.pop(request_id, None)

    async def notify(self, method: str, params: Any = None) -> None:
        """Send a client notification without allocating a response future."""

        frame: JsonObject = {"method": method}
        if params is not None:
            frame["params"] = params
        await self._send(frame)

    async def wait(self) -> int:
        """Wait until the managed process and reader loop have stopped."""

        if self._watchdog_managed:
            # asyncio's Process.wait() can wait for inherited stdout/stderr EOF
            # after the wrapper PID is already reaped. Poll returncode first so
            # a crashed wrapper cannot strand us behind its surviving target.
            returncode = await self._wait_for_process_returncode()
        else:
            returncode = await self._process.wait()
        # If the leader exited while descendants retained its stdio pipes,
        # terminate the still-owned group before waiting for reader EOF.
        await self._stop_owned_process()
        await asyncio.gather(self._reader_task, return_exceptions=True)
        await self._cancel_server_requests()
        return returncode

    async def close(self) -> None:
        """Stop the owned process, escalating to kill only after a timeout."""

        async with self._close_lock:
            if self._closed:
                return
            self._closing = True
            try:
                if (
                    self._process.stdin is not None
                    and not self._process.stdin.is_closing()
                ):
                    self._process.stdin.close()
                await self._stop_owned_process()
                await asyncio.gather(self._reader_task, return_exceptions=True)
                await self._cancel_server_requests()
                if self._stderr_task is not None:
                    await asyncio.gather(self._stderr_task, return_exceptions=True)
            except BaseException:
                # Retain a retryable owner state. The caller/registry must not
                # discard this client until a later close confirms containment.
                raise
            else:
                self._closed = True
            finally:
                self._closing = False

    async def _send(self, frame: JsonObject) -> None:
        if self._closed or self._closing or self._stdin.is_closing():
            raise JsonRpcProcessExited(self._process.returncode, self._stderr_tail)
        encoded = json.dumps(frame, separators=(",", ":"), ensure_ascii=False).encode()
        if len(encoded) > MAX_JSONRPC_FRAME_BYTES:
            raise JsonRpcProtocolError("outbound app-server frame exceeds size limit")
        async with self._write_lock:
            self._stdin.write(encoded + b"\n")
            await self._stdin.drain()

    async def _read_loop(self) -> None:
        failure: Exception | None = None
        try:
            while line := await self._stdout.readline():
                try:
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise JsonRpcProtocolError("app-server frame must be an object")
                    await self._dispatch(value)
                except json.JSONDecodeError as exc:
                    raise JsonRpcProtocolError("app-server emitted invalid JSON") from exc
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            failure = exc
            logger.warning(
                "app-server JSON-RPC reader failed: %s",
                sanitize_external_message(exc),
            )
        finally:
            returncode = self._process.returncode
            if returncode is None:
                if not (self._closed or self._closing):
                    # A malformed frame or a notification-handler failure can
                    # end the reader while the peer itself remains alive. Do
                    # not strand every pending request behind process.wait().
                    # End the peer so callers observe the protocol failure
                    # immediately and the runtime watcher can reconcile state.
                    await self._stop_owned_process()
                else:
                    await self._process.wait()
                returncode = self._process.returncode
            if failure is None:
                terminal_error: Exception = JsonRpcProcessExited(
                    returncode, self._stderr_tail
                )
            elif isinstance(failure, JsonRpcClientError):
                terminal_error = failure
            else:
                terminal_error = JsonRpcProtocolError(
                    sanitize_external_message(failure)
                )
            for future in tuple(self._pending.values()):
                if not future.done():
                    future.set_exception(terminal_error)

    async def _stop_owned_process(self) -> None:
        """Terminate the validated process group, escalating after a grace."""

        async with self._process_stop_lock:
            if self._watchdog_managed:
                if self._watchdog_write_fd is not None:
                    os.close(self._watchdog_write_fd)
                    self._watchdog_write_fd = None
                if self._process.returncode is None:
                    try:
                        await self._wait_for_process_returncode(
                            timeout=WATCHDOG_STOP_TIMEOUT_SECONDS,
                        )
                    except TimeoutError as exc:
                        raise JsonRpcContainmentError(
                            "Chat watchdog did not contain the process tree in time"
                        ) from exc
                if not self._watchdog_containment_confirmed:
                    cleanup_fd = self._watchdog_cleanup_fd
                    if cleanup_fd is None:
                        await self._contain_orphaned_target_group()
                    else:
                        self._watchdog_cleanup_fd = None
                        try:
                            _read_watchdog_cleanup(cleanup_fd)
                        except JsonRpcContainmentError:
                            # If the external watchdog itself was killed or
                            # crashed, its private cleanup pipe closes without an
                            # acknowledgement. Immediately contain the still-known
                            # target PGID before registry ownership can be released.
                            await self._contain_orphaned_target_group()
                    self._watchdog_containment_confirmed = True
                # Confirmation means no target descendant can retain the
                # wrapper's pipes, so Process.wait() is now safe to finish its
                # transport teardown.
                await self._process.wait()
                return

            if self._process_group_id is None:
                if self._process.returncode is None:
                    try:
                        self._process.terminate()
                    except ProcessLookupError:
                        pass
                    try:
                        await asyncio.wait_for(
                            self._process.wait(),
                            timeout=PROCESS_TERMINATE_GRACE_SECONDS,
                        )
                    except TimeoutError:
                        try:
                            self._process.kill()
                        except ProcessLookupError:
                            pass
                        await self._process.wait()
                return

            process_group_id = self._process_group_id
            self._signal_process_group(process_group_id, signal.SIGTERM)
            deadline = (
                asyncio.get_running_loop().time()
                + PROCESS_TERMINATE_GRACE_SECONDS
            )
            while self._process_group_exists(process_group_id):
                if asyncio.get_running_loop().time() >= deadline:
                    self._signal_process_group(process_group_id, signal.SIGKILL)
                    break
                await asyncio.sleep(0.025)
            if self._process.returncode is None:
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=1)
                except TimeoutError:
                    # The validated group signal should normally reap the
                    # leader. Keep a direct-PID fallback for unusual child
                    # watcher/platform behavior.
                    try:
                        self._process.kill()
                    except ProcessLookupError:
                        pass
                    await self._process.wait()

    async def _contain_orphaned_target_group(self) -> None:
        process_group_id = self._process_group_id
        if process_group_id is None:
            raise JsonRpcContainmentError(
                "Chat watchdog failed without a target process-group identity"
            )
        try:
            self._signal_process_group(process_group_id, signal.SIGTERM)
            deadline = (
                asyncio.get_running_loop().time()
                + PROCESS_TERMINATE_GRACE_SECONDS
            )
            while self._process_group_exists(process_group_id):
                if asyncio.get_running_loop().time() >= deadline:
                    self._signal_process_group(process_group_id, signal.SIGKILL)
                    break
                await asyncio.sleep(0.025)
            deadline = asyncio.get_running_loop().time() + 1
            while self._process_group_exists(process_group_id):
                if asyncio.get_running_loop().time() >= deadline:
                    raise JsonRpcContainmentError(
                        "Fallback could not confirm Chat process-group containment"
                    )
                await asyncio.sleep(0.025)
        except PermissionError as exc:
            raise JsonRpcContainmentError(
                "Fallback lost permission to contain Chat process group"
            ) from exc

    async def _wait_for_process_returncode(
        self,
        *,
        timeout: float | None = None,
    ) -> int:
        deadline = (
            None
            if timeout is None
            else asyncio.get_running_loop().time() + timeout
        )
        while self._process.returncode is None:
            if deadline is not None and asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError
            await asyncio.sleep(0.025)
        return self._process.returncode

    @staticmethod
    def _signal_process_group(process_group_id: int, sig: signal.Signals) -> bool:
        try:
            os.killpg(process_group_id, sig)
        except ProcessLookupError:
            return False
        return True

    @staticmethod
    def _process_group_exists(process_group_id: int) -> bool:
        try:
            os.killpg(process_group_id, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    async def _dispatch(self, frame: JsonObject) -> None:
        request_id = frame.get("id")
        method = frame.get("method")
        if request_id is not None and method is None:
            future = self._pending.get(request_id)
            if future is None or future.done():
                return
            error = frame.get("error")
            if isinstance(error, dict):
                future.set_exception(
                    JsonRpcRemoteError(
                        int(error.get("code", -32000)),
                        str(error.get("message", "Unknown remote error")),
                        error.get("data"),
                    )
                )
            elif "result" in frame:
                future.set_result(frame["result"])
            else:
                future.set_exception(JsonRpcProtocolError("response has no result or error"))
            return

        if isinstance(method, str) and request_id is not None:
            # An approval handler can legitimately remain pending while the
            # user reviews it. Keep reading notifications and other responses
            # from the bidirectional stream during that wait.
            result: Any = None
            failure: Exception | None = None
            if self._on_request is None:
                failure = JsonRpcServerRequestError(
                    -32601,
                    f"Unsupported request: {method}",
                )
            else:
                try:
                    # Invoke synchronously so handlers can register provider
                    # correlation before a buffered resolved notification is
                    # read. Long-lived work remains in the task below.
                    result = self._on_request(
                        request_id,
                        method,
                        frame.get("params"),
                    )
                except Exception as exc:
                    failure = exc
            task = asyncio.create_task(
                self._finish_server_request(
                    request_id,
                    result=result,
                    failure=failure,
                )
            )
            self._server_request_tasks.add(task)
            task.add_done_callback(self._server_request_tasks.discard)
            if isinstance(result, ServerRequestOperation):
                try:
                    await result.ready
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # The response task sends the correlated JSON-RPC error.
                    pass
            return

        if isinstance(method, str):
            if self._on_notification is not None:
                result = self._on_notification(method, frame.get("params"))
                if inspect.isawaitable(result):
                    await result
            return

        raise JsonRpcProtocolError("unrecognized app-server frame")

    async def _finish_server_request(
        self,
        request_id: int | str,
        *,
        result: Any,
        failure: Exception | None,
    ) -> None:
        try:
            if failure is not None:
                raise failure
            if isinstance(result, ServerRequestOperation):
                result = result.result
            if inspect.isawaitable(result):
                result = await result
            await self._send({"id": request_id, "result": result})
        except JsonRpcServerRequestError as exc:
            try:
                error: JsonObject = {
                    "code": exc.code,
                    "message": exc.message,
                }
                if exc.data is not None:
                    error["data"] = exc.data
                await self._send({"id": request_id, "error": error})
            except JsonRpcProcessExited:
                return
        except JsonRpcProcessExited:
            # Closing the owned process cancels pending provider prompts. The
            # peer can disappear between resolving that prompt and writing its
            # correlated response; the reader/watch path owns the exit state.
            return
        except Exception as exc:
            try:
                await self._send(
                    {
                        "id": request_id,
                        "error": {
                            "code": -32603,
                            "message": sanitize_external_message(exc)
                            or "Request failed",
                        },
                    }
                )
            except JsonRpcProcessExited:
                return

    async def _cancel_server_requests(self) -> None:
        tasks = tuple(self._server_request_tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _drain_stderr(self) -> None:
        assert self._stderr is not None
        while line := await self._stderr.readline():
            self._stderr_tail.append(
                sanitize_external_message(
                    line.decode(errors="replace").rstrip(),
                    max_chars=MAX_STDERR_LINE_CHARS,
                )
            )
