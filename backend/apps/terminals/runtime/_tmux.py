"""Tmux-backed implementation of the persistence-free terminal runtime."""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Callable
from typing import Any

import ptyprocess

from apps.terminals.tmux import client as tmux_client
from apps.terminals.tmux._core import (
    _server,
    _session_name,
    tmux_executable,
    tmux_runtime_namespace,
    tmux_socket,
)

from ._contract import (
    CreateTerminal,
    TerminalAlreadyExists,
    TerminalAttachment,
    TerminalDimensions,
    TerminalNotFound,
    TerminalObservation,
    TerminalObservationError,
    TerminalRuntimeError,
    TerminalState,
    TerminationResult,
)


logger = logging.getLogger(__name__)

_VIEWER_LC_CTYPE = "UTF-8" if sys.platform == "darwin" else "C.UTF-8"


def _stderr(result: Any) -> str:
    return "\n".join(result.stderr or [])


def _target_is_missing(result: Any) -> bool:
    message = _stderr(result).lower()
    return (
        "can't find session" in message
        or "no server running on" in message
        or "no such file or directory" in message
    )


class _TmuxAttachment(TerminalAttachment):
    def __init__(
        self,
        *,
        agent_run_id: str,
        process: ptyprocess.PtyProcess,
    ) -> None:
        self._agent_run_id = agent_run_id
        self._process = process
        self._detached = False

    def read(self, size: int = 4096) -> bytes:
        return self._process.read(size)

    def write(self, data: bytes) -> None:
        if not isinstance(data, bytes):
            raise TypeError("terminal input must be bytes")
        self._process.write(data)

    def resize(self, dimensions: TerminalDimensions) -> None:
        self._process.setwinsize(dimensions.rows, dimensions.columns)
        tmux_client.refresh_client_size(
            self._agent_run_id,
            dimensions.columns,
            dimensions.rows,
        )

    def scroll(self, direction: str, lines: int = 3) -> None:
        tmux_client.scroll(self._agent_run_id, direction, lines)

    @property
    def completed(self) -> bool:
        if self._detached:
            return True
        return not self._process.isalive()

    def wait(self) -> int | None:
        if self._detached:
            return None
        self._process.wait()
        if self._process.exitstatus is not None:
            return self._process.exitstatus
        if self._process.signalstatus is not None:
            return -self._process.signalstatus
        return None

    def detach(self) -> None:
        if self._detached:
            return
        self._detached = True
        try:
            if self._process.isalive():
                self._process.terminate(force=True)
        except Exception:
            logger.warning(
                "terminal viewer detach failed agent_run_id=%s",
                self._agent_run_id,
                exc_info=True,
            )


class TmuxTerminalRuntime:
    """Durable terminal mechanics on Ticketry's isolated tmux socket."""

    def __init__(self, *, _server_factory: Callable[[], Any] = _server) -> None:
        self._server_factory = _server_factory

    @property
    def namespace(self) -> str:
        """Identify the effective tmux endpoint whose inventory is owned."""

        return tmux_runtime_namespace()

    @property
    def legacy_namespaces(self) -> tuple[str, ...]:
        """Recognize rows persisted before the socket-root identity fix."""

        return (tmux_socket(),)

    def create(self, request: CreateTerminal) -> None:
        agent_run_id = request.agent_run_id
        name = _session_name(agent_run_id)
        try:
            server = self._server_factory()
            exists = server.cmd("has-session", "-t", name)
        except Exception as exc:
            raise TerminalRuntimeError(
                f"could not create terminal for AgentRun {agent_run_id}"
            ) from exc
        if exists.returncode == 0:
            raise TerminalAlreadyExists(agent_run_id)
        if not _target_is_missing(exists):
            raise TerminalRuntimeError(
                f"could not check terminal for AgentRun {agent_run_id}"
            )

        argv = [
            "new-session",
            "-d",
            "-s",
            name,
            "-c",
            str(request.working_directory),
            "-x",
            str(request.dimensions.columns),
            "-y",
            str(request.dimensions.rows),
        ]
        for key, value in request.environment.items():
            if not key or "=" in key or "\x00" in key or "\x00" in value:
                raise ValueError(f"invalid terminal environment key: {key!r}")
            argv.extend(("-e", f"{key}={value}"))

        try:
            created = server.cmd(*argv)
        except Exception as exc:
            raise TerminalRuntimeError(
                f"could not create terminal for AgentRun {agent_run_id}"
            ) from exc
        if created.returncode != 0:
            raise TerminalRuntimeError(
                f"could not create terminal for AgentRun {agent_run_id}"
            )
        try:
            settings = (
                ("set-option", "-w", "-t", name, "remain-on-exit", "on"),
                ("set-option", "-t", name, "window-size", "manual"),
                ("set-option", "-t", name, "status", "off"),
                (
                    "set-option",
                    "-t",
                    name,
                    "@pt-agent-run-id",
                    agent_run_id,
                ),
            )
            for command in settings:
                result = server.cmd(*command)
                if result.returncode != 0:
                    raise TerminalRuntimeError("tmux configuration failed")
            started = server.cmd(
                "respawn-pane", "-k", "-t", name, request.command
            )
            if started.returncode != 0:
                raise TerminalRuntimeError("hosted command start failed")
        except Exception as exc:
            server.cmd("kill-session", "-t", name)
            if isinstance(exc, TerminalRuntimeError):
                raise TerminalRuntimeError(
                    f"could not initialize terminal for AgentRun {agent_run_id}"
                ) from exc
            raise
        logger.info("terminal runtime created agent_run_id=%s", agent_run_id)

    def attach(self, agent_run_id: str) -> TerminalAttachment:
        observation = self.inspect(agent_run_id)
        if observation.state is TerminalState.MISSING:
            raise TerminalNotFound(agent_run_id)
        environment = dict(os.environ)
        environment["TERM"] = "xterm-256color"
        environment.pop("LC_ALL", None)
        environment["LC_CTYPE"] = _VIEWER_LC_CTYPE
        environment.pop("TERMINFO", None)
        environment.pop("TERMINFO_DIRS", None)
        try:
            process = ptyprocess.PtyProcess.spawn(
                [
                    tmux_executable(),
                    "-L",
                    tmux_socket(),
                    "attach",
                    "-t",
                    _session_name(agent_run_id),
                ],
                env=environment,
                echo=False,
            )
        except Exception as exc:
            raise TerminalRuntimeError(
                f"could not attach terminal for AgentRun {agent_run_id}"
            ) from exc
        logger.info("terminal viewer attached agent_run_id=%s", agent_run_id)
        return _TmuxAttachment(agent_run_id=agent_run_id, process=process)

    def inspect(self, agent_run_id: str) -> TerminalObservation:
        name = _session_name(agent_run_id)
        try:
            server = self._server_factory()
            exists = server.cmd("has-session", "-t", name)
        except Exception as exc:
            raise TerminalObservationError(
                f"could not inspect terminal for AgentRun {agent_run_id}"
            ) from exc
        if exists.returncode != 0:
            if _target_is_missing(exists):
                return TerminalObservation(TerminalState.MISSING)
            raise TerminalObservationError(
                f"could not inspect terminal for AgentRun {agent_run_id}"
            )

        try:
            panes = server.cmd(
                "list-panes",
                "-t",
                name,
                "-F",
                "#{pane_dead}|#{pane_dead_status}",
            )
        except Exception as exc:
            raise TerminalObservationError(
                f"could not inspect terminal for AgentRun {agent_run_id}"
            ) from exc
        if panes.returncode != 0:
            if _target_is_missing(panes):
                return TerminalObservation(TerminalState.MISSING)
            raise TerminalObservationError(
                f"could not inspect terminal for AgentRun {agent_run_id}"
            )
        states: list[tuple[bool, int | None]] = []
        for line in panes.stdout or []:
            dead, separator, raw_status = line.partition("|")
            if not separator or dead not in {"0", "1"}:
                raise TerminalObservationError(
                    f"tmux returned malformed terminal state for AgentRun {agent_run_id}"
                )
            try:
                exit_code = int(raw_status) if raw_status else None
            except ValueError as exc:
                raise TerminalObservationError(
                    f"tmux returned malformed exit status for AgentRun {agent_run_id}"
                ) from exc
            states.append((dead == "1", exit_code))
        if not states:
            raise TerminalObservationError(
                f"tmux returned no panes for AgentRun {agent_run_id}"
            )
        if not all(dead for dead, _ in states):
            return TerminalObservation(TerminalState.RUNNING)
        exit_codes = [code for _, code in states if code is not None]
        exit_code = exit_codes[0] if len(set(exit_codes)) == 1 and exit_codes else None
        return TerminalObservation(TerminalState.EXITED, exit_code)

    def terminate(self, agent_run_id: str) -> TerminationResult:
        name = _session_name(agent_run_id)
        try:
            server = self._server_factory()
            exists = server.cmd("has-session", "-t", name)
        except Exception as exc:
            raise TerminalRuntimeError(
                f"could not inspect terminal for AgentRun {agent_run_id}"
            ) from exc
        if exists.returncode != 0:
            if _target_is_missing(exists):
                return TerminationResult(was_present=False)
            raise TerminalRuntimeError(
                f"could not inspect terminal for AgentRun {agent_run_id}"
            )
        try:
            killed = server.cmd("kill-session", "-t", name)
        except Exception as exc:
            raise TerminalRuntimeError(
                f"could not terminate terminal for AgentRun {agent_run_id}"
            ) from exc
        if killed.returncode != 0:
            if _target_is_missing(killed):
                return TerminationResult(was_present=False)
            raise TerminalRuntimeError(
                f"could not terminate terminal for AgentRun {agent_run_id}"
            )
        logger.info("terminal runtime terminated agent_run_id=%s", agent_run_id)
        return TerminationResult(was_present=True)
