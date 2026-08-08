"""Authenticated replay/live WebSocket transport for structured Chat runs."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from urllib.parse import parse_qs

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from pydantic import ValidationError

from apps.runs.chat.bus import (
    chat_group,
    register_publish_loop,
    unregister_publish_loop,
)
from apps.runs.chat.contracts import (
    CHAT_CLIENT_COMMAND_ADAPTER,
    ChatApprovalResponseCommand,
    ChatCommandAckFrame,
    ChatErrorFrame,
    ChatEventFrame,
    ChatEventRecord,
    ChatInterruptCommand,
    ChatReadyFrame,
    ChatStartTurnCommand,
    ChatStopCommand,
    ChatUserInputResponseCommand,
)
from apps.runs.chat.codex_runtime import TurnStartError
from apps.runs.chat.runtime_supervisor import runtime_supervisor
from apps.runs.chat.safety import sanitize_external_message
from apps.runs.chat.service import ChatRunError, chat_session
from apps.runs.chat.snapshots import (
    ChatCursorAhead,
    ChatRunNotFound,
    load_chat_snapshot,
)


logger = logging.getLogger(__name__)


class ChatStreamConsumer(AsyncJsonWebsocketConsumer):
    """Serve one run's durable transcript, then its ordered live tail."""

    async def connect(self) -> None:
        params = parse_qs(
            self.scope["query_string"].decode(),
            keep_blank_values=True,
        )
        agent_run_id = _single_param(params, "agent_run_id")
        if not agent_run_id:
            await self.close(code=4400)
            return
        if not _authorized(self.scope, params):
            await self.close(code=4401)
            return
        try:
            cursor = _cursor_param(params)
        except ValueError:
            await self.close(code=4400)
            return

        self.agent_run_id = agent_run_id
        self.group_name = chat_group(agent_run_id)
        self.publish_loop = asyncio.get_running_loop()
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        register_publish_loop(agent_run_id, self.publish_loop)
        try:
            snapshot = await sync_to_async(
                load_chat_snapshot,
                thread_sensitive=True,
            )(agent_run_id=agent_run_id, after=cursor)
        except ChatRunNotFound:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            unregister_publish_loop(agent_run_id, self.publish_loop)
            self.publish_loop = None
            await self.close(code=4404)
            return
        except ChatCursorAhead:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            unregister_publish_loop(agent_run_id, self.publish_loop)
            self.publish_loop = None
            await self.close(code=4400)
            return
        except Exception:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            unregister_publish_loop(agent_run_id, self.publish_loop)
            self.publish_loop = None
            raise

        self.last_sequence = snapshot.cursor
        await self.accept()
        await self.send_json(snapshot.model_dump(mode="json"))
        await self.send_json(
            ChatReadyFrame(
                agent_run_id=agent_run_id,
                cursor=snapshot.cursor,
            ).model_dump(mode="json")
        )

    async def chat_event(self, message: dict) -> None:
        """Forward a committed delta once, repairing any sequence gap first."""

        frame = ChatEventFrame.model_validate(message["frame"])
        sequence = frame.event.sequence
        if sequence <= self.last_sequence:
            return
        if sequence > self.last_sequence + 1:
            snapshot = await sync_to_async(
                load_chat_snapshot,
                thread_sensitive=True,
            )(
                agent_run_id=self.agent_run_id,
                after=self.last_sequence,
            )
            for event in snapshot.events:
                if event.sequence <= self.last_sequence:
                    continue
                await self._send_event(event)
            return
        await self._send_event(frame.event)

    async def _send_event(self, event: ChatEventRecord) -> None:
        frame = ChatEventFrame(
            agent_run_id=self.agent_run_id,
            event=event,
        )
        await self.send_json(frame.model_dump(mode="json"))
        self.last_sequence = event.sequence

    async def receive(self, text_data=None, bytes_data=None, **kwargs) -> None:
        """Decode text frames without letting malformed JSON kill the socket."""

        if text_data is None or bytes_data is not None:
            await self._send_command_error(
                code="invalid_command",
                message="Chat commands must be JSON text frames.",
            )
            return
        try:
            content = json.loads(text_data)
        except json.JSONDecodeError:
            await self._send_command_error(
                code="invalid_command",
                message="Invalid Chat command frame.",
            )
            return
        await self.receive_json(content, **kwargs)

    async def receive_json(self, content, **kwargs) -> None:
        """Validate and dispatch one provider-neutral Chat command."""

        command_id = _untrusted_command_id(content)
        try:
            command = CHAT_CLIENT_COMMAND_ADAPTER.validate_python(content)
        except ValidationError:
            await self._send_command_error(
                code="invalid_command",
                message="Invalid Chat command frame.",
                command_id=command_id,
            )
            return

        try:
            result = await self._execute_command(command)
        except ChatRunError as exc:
            await self._send_command_error(
                code=exc.code,
                message=exc.code,
                command_id=command.command_id,
            )
            return
        except TurnStartError as exc:
            await self._send_command_error(
                code=(
                    "turn_delivery_unknown"
                    if exc.delivery_unknown
                    else "command_rejected"
                ),
                message=sanitize_external_message(exc)
                or "Chat turn could not be started.",
                command_id=command.command_id,
                retryable=not exc.delivery_unknown,
            )
            return
        except (RuntimeError, ValueError) as exc:
            await self._send_command_error(
                code="command_rejected",
                message=sanitize_external_message(exc)
                or "Chat command was rejected.",
                command_id=command.command_id,
            )
            return
        except Exception:
            logger.exception(
                "Chat command failed for run %s",
                self.agent_run_id,
            )
            await self._send_command_error(
                code="command_failed",
                message="Chat command failed.",
                command_id=command.command_id,
                retryable=True,
            )
            return

        ack = ChatCommandAckFrame(
            agent_run_id=self.agent_run_id,
            command_id=command.command_id,
            command=command.type,
            result=result,
        )
        await self.send_json(ack.model_dump(mode="json"))

    async def _execute_command(self, command) -> dict:
        if isinstance(command, ChatStartTurnCommand):
            turn_id = await runtime_supervisor.call(
                lambda: chat_session.send_turn(
                    self.agent_run_id,
                    command.prompt,
                    command_id=command.command_id,
                )
            )
            return {"turn_id": turn_id}
        if isinstance(command, ChatInterruptCommand):
            interrupted = await runtime_supervisor.call(
                lambda: chat_session.interrupt(self.agent_run_id)
            )
            return {"interrupted": interrupted}
        if isinstance(command, ChatApprovalResponseCommand):
            await runtime_supervisor.call(
                lambda: chat_session.respond_to_approval(
                    self.agent_run_id,
                    command.request_id,
                    command.decision,
                )
            )
            return {"accepted": True}
        if isinstance(command, ChatUserInputResponseCommand):
            await runtime_supervisor.call(
                lambda: chat_session.respond_to_user_input(
                    self.agent_run_id,
                    command.request_id,
                    command.answers,
                )
            )
            return {"accepted": True}
        if isinstance(command, ChatStopCommand):
            stopped_live_process = await runtime_supervisor.call(
                lambda: chat_session.stop(self.agent_run_id)
            )
            return {
                "stopped": True,
                "stopped_live_process": stopped_live_process,
            }
        raise TypeError(f"Unhandled Chat command: {command.type}")

    async def _send_command_error(
        self,
        *,
        code: str,
        message: str,
        command_id: str | None = None,
        retryable: bool = False,
    ) -> None:
        frame = ChatErrorFrame(
            agent_run_id=self.agent_run_id,
            code=code,
            message=message,
            command_id=command_id,
            retryable=retryable,
        )
        await self.send_json(frame.model_dump(mode="json"))

    async def disconnect(self, code: int) -> None:
        group_name = getattr(self, "group_name", None)
        if group_name:
            await self.channel_layer.group_discard(group_name, self.channel_name)
        publish_loop = getattr(self, "publish_loop", None)
        if publish_loop is not None:
            unregister_publish_loop(self.agent_run_id, publish_loop)
            self.publish_loop = None


def _single_param(params: dict[str, list[str]], name: str) -> str | None:
    values = params.get(name)
    if values is None or len(values) != 1:
        return None
    return values[0]


def _cursor_param(params: dict[str, list[str]]) -> int:
    raw = _single_param(params, "cursor")
    if raw is None:
        return 0
    cursor = int(raw)
    if cursor < 0:
        raise ValueError("cursor must be non-negative")
    return cursor


def _authorized(scope: dict, params: dict[str, list[str]]) -> bool:
    if getattr(settings, "WORKTRACKER_DISABLE_AUTH", False):
        return True
    expected = getattr(settings, "WORKTRACKER_API_TOKEN", "")
    supplied = _single_param(params, "api_key") or _header(scope, b"x-api-key")
    return bool(expected and supplied and secrets.compare_digest(expected, supplied))


def _header(scope: dict, name: bytes) -> str | None:
    values = [value for key, value in scope.get("headers", []) if key.lower() == name]
    if len(values) != 1:
        return None
    return values[0].decode("latin-1")


def _untrusted_command_id(content) -> str | None:
    if not isinstance(content, dict):
        return None
    value = content.get("command_id")
    if not isinstance(value, str) or not value:
        return None
    return value[:128]
