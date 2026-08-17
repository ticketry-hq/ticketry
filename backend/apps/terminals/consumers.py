"""Terminal-attachment WebSocket adapter.

The adapter owns WebSocket acceptance, validation, framing, and closure while
the terminal runtime owns attachment mechanics:

- Incoming frames arrive via :meth:`TerminalConsumer.receive` callbacks and
  are buffered into a per-connection ``asyncio.Queue``.
- A dedicated task drives spawn/attach and pumps raw attachment bytes.
- ``disconnect`` cancels both pumps and detaches only the transient viewer.
- Attachment EOF closes the viewer directly; it does not reconcile run state.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Optional

from channels.generic.websocket import AsyncWebsocketConsumer

from apps.runs.models import AgentRun
from apps.terminals.control_plane import create_terminal_run
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.launch import LaunchUnavailable
from apps.terminals.prompt_builder import _build_prompt  # noqa: F401 - test seam
from apps.terminals import viewer_attachments
from apps.terminals.output_activity import TerminalOutputObserver
from apps.terminals.reconciliation_scheduler import (
    schedule_terminal_reconciliation,
)
from apps.terminals.runtime import (
    TerminalDimensions,
    TerminalNotFound,
)
from apps.terminals.validation import (
    MAX_SESSIONS,
    AttachRequest,
    _validate_init,
)
from apps.settings_store.config import NoConfigurationSelected


logger = logging.getLogger(__name__)


class TerminalConsumer(AsyncWebsocketConsumer):
    """WebSocket adapter for a transport-independent terminal attachment.

    Responsibilities:

    - Accept the socket, buffer incoming frames into a queue, and run the
      init/spawn/attach orchestration in a dedicated task.
    - Stream attachment output as binary frames and forward input/controls.
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

        if viewer_attachments.active_count() >= MAX_SESSIONS:
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
        except RequiredSkillUnavailable as exc:
            payload = {"type": "error", **exc.as_payload()}
            try:
                await self.send(text_data=json.dumps(payload))
            finally:
                await self.close(code=1008)
            return
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
        )

    async def _attach_run(
        self,
        *,
        agent_run_id: str,
        cols: int,
        rows: int,
    ) -> None:
        session_id = uuid.uuid4().hex
        try:
            viewer = await asyncio.to_thread(
                viewer_attachments.acquire,
                agent_run_id=agent_run_id,
                viewer_id=session_id,
                dimensions=TerminalDimensions(cols, rows),
            )
        except TerminalNotFound:
            # A run that deliberately ended (including the MCP exit tool) is a
            # normal terminal outcome, not a missing-session failure.  The
            # runtime disappears before a reconnecting viewer can attach, so
            # classify from the already-persisted run fact before falling back
            # to reconciliation for a genuinely missing live session.
            ended = await AgentRun.objects.filter(
                id=agent_run_id,
                ended_at__isnull=False,
            ).aexists()
            if ended:
                await self._send_error("session_ended", close_code=1008)
                return
            # The runtime no longer has this session while its records may
            # still say it is running. Reconciling now lets the status feed
            # converge on "lost" within seconds instead of waiting for the
            # next idle sweep — the tab presents the pushed run projection,
            # so that projection must catch up with the observation quickly.
            schedule_terminal_reconciliation()
            await self._send_error("session_not_found", close_code=1008)
            return
        except Exception as e:
            await self._send_error(f"attachment_failed: {e!s}", close_code=1011)
            return

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
            await asyncio.to_thread(viewer.release)
            return
        await self._pump(viewer)

    async def _handle_attach(self, request: AttachRequest) -> None:
        await self._attach_run(
            agent_run_id=request.agent_run_id,
            cols=request.cols,
            rows=request.rows,
        )

    async def _pump(self, viewer: viewer_attachments.ViewerAttachment) -> None:
        attachment = viewer.attachment
        # Browser output reports through the shared activity operation. The
        # observer only takes note here; capture, comparison, persistence, and
        # publication happen out of band so this pump never waits on status.
        observer = TerminalOutputObserver(viewer.agent_run_id)
        observer.start()

        async def attachment_to_ws() -> None:
            while True:
                try:
                    chunk = await asyncio.to_thread(attachment.read, 4096)
                except EOFError:
                    return
                except Exception:
                    return
                if not chunk:
                    return
                try:
                    await self.send(bytes_data=chunk)
                except Exception:
                    return
                observer.note_output()

        async def ws_to_attachment() -> None:
            while True:
                try:
                    msg = await self._incoming.get()
                except Exception:
                    return
                if msg.get("bytes") is not None:
                    try:
                        await asyncio.to_thread(
                            attachment.write,
                            msg["bytes"],
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
                        # The attachment decides how its scrollback is moved.
                        direction = payload.get("dir")
                        lines = payload.get("lines", 3)
                        if (
                            direction in ("up", "down")
                            and isinstance(lines, int)
                            and lines > 0
                        ):
                            try:
                                await asyncio.to_thread(attachment.scroll, direction, lines)
                            except Exception:
                                pass
                        continue
                    if payload.get("type") == "resize":
                        cols = payload.get("cols")
                        rows = payload.get("rows")
                        if (
                            isinstance(cols, int)
                            and isinstance(rows, int)
                            and cols > 0
                            and rows > 0
                        ):
                            try:
                                await asyncio.to_thread(
                                    attachment.resize,
                                    TerminalDimensions(cols, rows),
                                )
                            except Exception:
                                pass

        async def renew_viewer_lease() -> None:
            while True:
                await asyncio.sleep(10)
                current = await asyncio.to_thread(
                    viewer_attachments.renew,
                    viewer,
                )
                if not current:
                    await self._send_error("replaced_by_another_viewer", close_code=4009)
                    return

        pump_a = asyncio.create_task(attachment_to_ws())
        pump_b = asyncio.create_task(ws_to_attachment())
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
            observer.close()
            await asyncio.to_thread(viewer.release)
            try:
                await self.close(code=1000)
            except Exception:
                pass
