"""PTY terminal WebSocket consumer (ticket #535).

Channels port of the FastAPI ``/ws/terminal`` endpoint. The asyncio
machinery (ptyprocess, ``to_thread`` pumps, task races) is a verbatim port;
only the WebSocket API surface changes:

- Incoming frames arrive via :meth:`TerminalConsumer.receive` callbacks and
  are buffered into a per-connection ``asyncio.Queue``.
- A dedicated orchestration task reads the init frame from that queue and
  drives the spawn/attach flow; the pump's ws->pty side then drains the same
  queue for keystrokes and resize frames.
- ``disconnect`` cancels the orchestration/pump tasks, which triggers the
  same ``finally:`` cleanup as a client-side close did under FastAPI.

Persistence uses the synchronous Django ORM inside ``to_thread`` workers
(replacing the SQLAlchemy ``asyncio.run`` bridges); everything else — config,
WorkTracker access, design-doc resolution, agent launching — is the unchanged
settings-store / terminals.agents surface.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import uuid
from typing import Optional

import ptyprocess
from channels.generic.websocket import AsyncWebsocketConsumer

from apps.terminals.control_plane import create_terminal_run, launch_intent_from_spawn
from apps.terminals import session as session_module
from apps.terminals.session import (
    LaunchUnavailable,
    SessionNotFound,
    session as terminal_session,
)
from apps.terminals.prompt_builder import _build_prompt  # noqa: F401 - test seam
from apps.terminals.session_registry import (
    PtySession,
    SESSIONS,
    TMUX_VIEWERS,  # noqa: F401 - compatibility/test seam
)
from apps.terminals import viewer_leases
from apps.terminals.validation import (
    MAX_SESSIONS,
    AttachRequest,
    _validate_init,
)
from apps.settings_store.config import NoConfigurationSelected


logger = logging.getLogger(__name__)

_VIEWER_TERM = "xterm-256color"
_VIEWER_LC_CTYPE = "UTF-8" if sys.platform == "darwin" else "C.UTF-8"


def _viewer_environment() -> dict[str, str]:
    """Return a deterministic terminal environment for the tmux viewer PTY.

    Finder-launched desktop applications commonly inherit ``TERM=dumb`` and no
    UTF-8 locale. The former makes ``tmux attach`` exit because the entry has no
    clear-screen capability; the latter makes tmux replace Unicode cells with
    underscores. Describe the browser renderer and its encoding explicitly,
    regardless of the environment inherited by the sidecar.
    """

    environment = os.environ.copy()
    environment["TERM"] = _VIEWER_TERM
    environment.pop("LC_ALL", None)
    environment["LC_CTYPE"] = _VIEWER_LC_CTYPE
    environment.pop("TERMINFO", None)
    environment.pop("TERMINFO_DIRS", None)
    return environment


class _TmuxCompat:
    """Compatibility shim for tests that patch the pre-session tmux surface."""

    _session_names = {
        "create_session",
        "list_sessions",
        "get_session",
        "terminate_session",
        "reconcile_sessions",
        "ReconcileResult",
    }
    _client_names = {"attach_argv", "scroll", "refresh_client_size"}

    def __init__(self) -> None:
        self._created_sessions = {}

    def __getattr__(self, name):
        if name in self._session_names:
            return getattr(session_module.tmux_sessions, name)
        if name in self._client_names:
            return getattr(session_module.tmux_client, name)
        if name == "TmuxSessionError":
            return session_module.TerminalSessionError
        if name == "TmuxSession":
            return session_module.TmuxSession
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name in {"_session_names", "_client_names", "_created_sessions"}:
            super().__setattr__(name, value)
        elif name == "create_session":
            self._created_sessions = {}

            def create_and_cache(**kwargs):
                created = value(**kwargs)
                self._created_sessions[kwargs["agent_run_id"]] = created
                return created

            def get_cached(agent_run_id):
                return self._created_sessions.get(agent_run_id)

            setattr(session_module.tmux_sessions, "create_session", create_and_cache)
            setattr(session_module.tmux_sessions, "get_session", get_cached)
        elif name in self._session_names:
            setattr(session_module.tmux_sessions, name, value)
        elif name in self._client_names:
            setattr(session_module.tmux_client, name, value)
        else:
            super().__setattr__(name, value)


tmux = _TmuxCompat()


class TerminalConsumer(AsyncWebsocketConsumer):
    """Bridge one browser terminal to a tmux-attached PTY viewer.

    tmux is a hard launch requirement (ADR-0005, CODIN-800): a spawn that cannot
    create its tmux session fails loud (``spawn_failed``) rather than falling
    back to an untracked direct PTY. The only bare PTY here is the viewer
    running ``tmux attach``.

    Responsibilities:

    - Accept the socket, buffer incoming frames into a queue, and run the
      init/spawn/attach orchestration in a dedicated task.
    - Stream PTY output as binary frames and forward keystrokes/resize.
    - On disconnect, cancel the orchestration so the same cleanup runs as a
      client-driven close did under FastAPI.
    """

    async def connect(self) -> None:
        """Accept the socket and start the orchestration task."""

        # Incoming frames buffer here until the orchestrator/pump consume them.

        self._incoming: asyncio.Queue[dict] = asyncio.Queue()
        self._orchestrator: Optional[asyncio.Task] = None
        await self.accept()
        self._orchestrator = asyncio.create_task(self._orchestrate())

    async def receive(self, text_data=None, bytes_data=None) -> None:
        """Buffer a client frame for the orchestrator/pump to read."""

        self._incoming.put_nowait({"text": text_data, "bytes": bytes_data})

    async def disconnect(self, code: int) -> None:
        """Cancel the orchestration so the pump's cleanup runs."""

        orchestrator = getattr(self, "_orchestrator", None)
        if orchestrator is not None:
            orchestrator.cancel()

    async def _send_error(self, message: str, close_code: int = 1008) -> None:
        logger.warning("terminal websocket closing with error %s: %s", close_code, message)
        try:
            await self.send(text_data=json.dumps({"type": "error", "message": message}))
        except Exception:
            pass
        try:
            await self.close(code=close_code)
        except Exception:
            pass

    async def _orchestrate(self) -> None:
        """Read the init frame and drive the spawn/attach flow."""

        first_msg = await self._incoming.get()
        if first_msg.get("text") is None:
            await self._send_error("bad_init", close_code=1003)
            return
        try:
            payload = json.loads(first_msg["text"])
        except json.JSONDecodeError:
            await self._send_error("bad_init", close_code=1003)
            return

        init, err = _validate_init(payload)
        if err is not None:
            # Surface enough of the rejected init frame to tell which validation
            # branch fired, without logging prompt bodies (which can be large and
            # may contain task content). Keys are listed; only structural fields
            # carry their values.
            if isinstance(payload, dict):
                shape = {
                    k: (
                        f"<{type(v).__name__}:{len(v)}>"
                        if k in {"initial_prompt", "instant_prompt"} and isinstance(v, str)
                        else v
                    )
                    for k, v in payload.items()
                }
            else:
                shape = {"_type": type(payload).__name__}
            logger.warning("init rejected (%s); payload shape=%s", err, shape)
            await self._send_error(
                err, close_code=1003 if err in {"bad_init", "unknown_agent"} else 1008
            )
            return

        if len(SESSIONS) >= MAX_SESSIONS:
            await self._send_error("too_many_sessions", close_code=1013)
            return

        if isinstance(init, AttachRequest):
            await self._handle_attach(init)
            return

        try:
            # Compatibility only: new clients create through POST /terminals
            # and send attach mode. Direct WebSocket spawn remains supported
            # for existing Channels clients through the same control-plane
            # operation.
            agent_run_id = await create_terminal_run(init)
        except NoConfigurationSelected:
            await self._send_error("no_profile_selected", close_code=1008)
            return
        except LaunchUnavailable as exc:
            logger.warning("persisted spawn failed: %s", exc)
            await self._send_error(f"spawn_failed: {exc!s}", close_code=1011)
            return
        except ValueError as exc:
            message = str(exc) or exc.__class__.__name__
            await self._send_error(
                message,
                close_code=1003 if message == "unknown_agent" else 1011,
            )
            return
        except Exception as exc:
            logger.exception("terminal session spawn failed")
            await self._send_error(f"spawn_failed: {exc!s}", close_code=1011)
            return

        await self._attach_run(
            agent_run_id=agent_run_id,
            cols=init.cols,
            rows=init.rows,
            fallback_agent=init.agent,
            fallback_task_id=launch_intent_from_spawn(init).task_id,
            fallback_module_id=init.module_id,
            fallback_project_id=init.project_id,
        )

    async def _attach_run(
        self,
        *,
        agent_run_id: str,
        cols: int,
        rows: int,
        fallback_agent: str | None = None,
        fallback_task_id: str | None = None,
        fallback_module_id: str | None = None,
        fallback_project_id: str | None = None,
    ) -> None:
        session_id = uuid.uuid4().hex
        try:
            handle = await asyncio.to_thread(
                terminal_session.attach,
                agent_run_id,
                viewer_id=session_id,
            )
        except SessionNotFound:
            await self._send_error("session_not_found", close_code=1008)
            return
        except Exception as e:
            await self._send_error(f"tmux_lookup_failed: {e!s}", close_code=1011)
            return

        try:
            pty = await asyncio.to_thread(
                ptyprocess.PtyProcessUnicode.spawn,
                handle.attach_argv(),
                cwd=os.path.expanduser("~"),
                dimensions=(rows, cols),
                env=_viewer_environment(),
            )
        except Exception as e:
            await asyncio.to_thread(handle.release)
            await self._send_error(f"spawn_failed: {e!s}", close_code=1011)
            return

        tmux_session = handle.session
        session = PtySession(
            session_id=session_id,
            pty=pty,
            agent=tmux_session.agent or fallback_agent,
            task_id=tmux_session.task_id or fallback_task_id,
            module_id=tmux_session.module_id or fallback_module_id,
            agent_run_id=agent_run_id,
            project_id=tmux_session.project_id or fallback_project_id,
            extra={"attach_handle": handle},
        )
        try:
            await asyncio.to_thread(handle.resize, cols, rows)
        except Exception as e:
            session.terminate(force=True)
            SESSIONS.pop(session_id, None)
            await asyncio.to_thread(handle.release)
            await self._send_error(f"attach_resize_failed: {e!s}", close_code=1011)
            return

        try:
            displaced = await asyncio.to_thread(handle.activate, session)
        except Exception as e:
            session.terminate(force=True)
            await asyncio.to_thread(handle.release)
            await self._send_error(f"viewer_lease_failed: {e!s}", close_code=1011)
            return
        if displaced is not None:
            displaced.terminate(force=True)

        try:
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "ready",
                        "session_id": session_id,
                        "agent_run_id": agent_run_id,
                    }
                )
            )
        except Exception:
            session.terminate(force=True)
            await asyncio.to_thread(handle.release)
            return
        await self._pump(session)

    async def _handle_attach(self, request: AttachRequest) -> None:
        await self._attach_run(
            agent_run_id=request.agent_run_id,
            cols=request.cols,
            rows=request.rows,
        )

    async def _pump(self, session: PtySession) -> None:
        async def pty_to_ws() -> None:
            while True:
                try:
                    chunk = await asyncio.to_thread(session.pty.read, 4096)
                except EOFError:
                    return
                except Exception:
                    return
                if not chunk:
                    return
                data = chunk.encode("utf-8", errors="replace")
                try:
                    await self.send(bytes_data=data)
                except Exception:
                    return

        async def ws_to_pty() -> None:
            while True:
                try:
                    msg = await self._incoming.get()
                except Exception:
                    return
                if msg.get("bytes") is not None:
                    try:
                        await asyncio.to_thread(
                            session.pty.write,
                            msg["bytes"].decode("utf-8", errors="replace"),
                        )
                    except Exception:
                        return
                elif msg.get("text") is not None:
                    try:
                        payload = json.loads(msg["text"])
                    except Exception:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    if payload.get("type") == "scroll":
                        # Wheel/trackpad bridge (#578): drive tmux copy-mode
                        # scrollback instead of letting xterm emit cursor keys.
                        handle = session.extra.get("attach_handle")
                        direction = payload.get("dir")
                        lines = payload.get("lines", 3)
                        if (
                            handle is not None
                            and direction in ("up", "down")
                            and isinstance(lines, int)
                            and lines > 0
                        ):
                            try:
                                await asyncio.to_thread(handle.scroll, direction, lines)
                            except Exception:
                                pass
                        continue
                    if payload.get("type") == "resize":
                        cols = payload.get("cols")
                        rows = payload.get("rows")
                        if isinstance(cols, int) and isinstance(rows, int) and cols > 0 and rows > 0:
                            try:
                                session.setwinsize(rows, cols)
                            except Exception:
                                pass
                            # Sessions are created with ``window-size manual``
                            # (see tmux.create_session), so tmux ignores the
                            # attach client's SIGWINCH — the window only follows
                            # an explicit refresh-client -C. Mirror the attach
                            # path here or the window stays at its old size and
                            # tmux paints the surplus as a dotted dead band.
                            try:
                                handle = session.extra.get("attach_handle")
                                if handle is not None:
                                    await asyncio.to_thread(handle.resize, cols, rows)
                            except Exception:
                                pass

        async def renew_viewer_lease() -> None:
            while True:
                await asyncio.sleep(10)
                current = await asyncio.to_thread(
                    viewer_leases.renew,
                    agent_run_id=session.agent_run_id,
                    viewer_id=session.session_id,
                )
                if current is None:
                    await self._send_error("replaced_by_another_viewer", close_code=4009)
                    return

        pump_a = asyncio.create_task(pty_to_ws())
        pump_b = asyncio.create_task(ws_to_pty())
        lease_renewal = asyncio.create_task(renew_viewer_lease())

        try:
            done, pending = await asyncio.wait(
                {pump_a, pump_b, lease_renewal}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
        finally:
            # A disconnect cancels this coroutine mid-wait, so cancel both pumps
            # explicitly (idempotent) before the same teardown as a clean exit.
            pump_a.cancel()
            pump_b.cancel()
            lease_renewal.cancel()
            session.terminate(force=True)
            SESSIONS.pop(session.session_id, None)
            handle = session.extra.get("attach_handle")
            if handle is not None:
                await asyncio.to_thread(handle.release)
            try:
                await self.close(code=1000)
            except Exception:
                pass
