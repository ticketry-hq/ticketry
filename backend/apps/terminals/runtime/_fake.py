"""Deterministic in-memory implementation of the terminal runtime contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Event, Lock

from ._contract import (
    CreateTerminal,
    TerminalAlreadyExists,
    TerminalAttachment,
    TerminalDimensions,
    TerminalNotFound,
    TerminalObservation,
    TerminalObservationError,
    TerminalState,
    TerminationResult,
)


@dataclass
class _FakeTerminal:
    request: CreateTerminal
    output: bytearray = field(default_factory=bytearray)
    # What a capture would render. Fed output accumulates here and is never
    # drained by a viewer read, so two captures of an unchanged terminal are
    # byte-identical exactly as a real capture-pane is.
    screen: bytearray = field(default_factory=bytearray)
    exit_code: int | None = None
    exited: bool = False
    observation_error: Exception | None = None
    dimensions: TerminalDimensions | None = None
    scrolls: list[tuple[str, int]] = field(default_factory=list)
    attachments: list[_FakeAttachment] = field(default_factory=list)
    submitted_text: list[str] = field(default_factory=list)
    staged_text: list[str] = field(default_factory=list)
    lock: Lock = field(default_factory=Lock)


class _FakeAttachment(TerminalAttachment):
    def __init__(self, terminal: _FakeTerminal):
        self._terminal = terminal
        self._detached = Event()

    def read(self, size: int = 4096) -> bytes:
        if size < 1:
            raise ValueError("read size must be positive")
        with self._terminal.lock:
            data = bytes(self._terminal.output[:size])
            del self._terminal.output[:size]
            return data

    def write(self, data: bytes) -> None:
        if self.completed:
            raise RuntimeError("attachment is detached")
        if not isinstance(data, bytes):
            raise TypeError("terminal input must be bytes")
        with self._terminal.lock:
            self._terminal.output.extend(data)

    def resize(self, dimensions: TerminalDimensions) -> None:
        if self.completed:
            raise RuntimeError("attachment is detached")
        self._terminal.dimensions = dimensions

    def scroll(self, direction: str, lines: int = 3) -> None:
        if direction not in {"up", "down"}:
            raise ValueError(f"bad scroll direction: {direction!r}")
        if lines < 1:
            raise ValueError("scroll lines must be positive")
        if self.completed:
            raise RuntimeError("attachment is detached")
        self._terminal.scrolls.append((direction, lines))

    @property
    def completed(self) -> bool:
        return self._detached.is_set()

    def wait(self) -> int | None:
        self._detached.wait()
        return None

    def detach(self) -> None:
        self._detached.set()


class InMemoryTerminalRuntime:
    """Small fake for application and shared contract tests.

    ``finish`` and ``fail_observation`` are deliberate test controls. They
    model facts normally supplied by tmux without executing a command.
    """

    def __init__(
        self,
        *,
        namespace: str = "memory",
        legacy_namespaces: tuple[str, ...] = (),
    ) -> None:
        self._namespace = namespace
        self._legacy_namespaces = legacy_namespaces
        self._terminals: dict[str, _FakeTerminal] = {}
        self._lock = Lock()

    @property
    def namespace(self) -> str:
        return self._namespace

    @property
    def legacy_namespaces(self) -> tuple[str, ...]:
        return self._legacy_namespaces

    def create(self, request: CreateTerminal) -> None:
        with self._lock:
            if request.agent_run_id in self._terminals:
                raise TerminalAlreadyExists(request.agent_run_id)
            self._terminals[request.agent_run_id] = _FakeTerminal(
                request=request,
                dimensions=request.dimensions,
            )

    def attach(self, agent_run_id: str) -> TerminalAttachment:
        with self._lock:
            terminal = self._terminals.get(agent_run_id)
            if terminal is None:
                raise TerminalNotFound(agent_run_id)
            attachment = _FakeAttachment(terminal)
            terminal.attachments.append(attachment)
            return attachment

    def inspect(self, agent_run_id: str) -> TerminalObservation:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            return TerminalObservation(TerminalState.MISSING)
        if terminal.observation_error is not None:
            raise TerminalObservationError(
                f"could not inspect terminal for AgentRun {agent_run_id}"
            ) from terminal.observation_error
        if terminal.exited:
            return TerminalObservation(TerminalState.EXITED, terminal.exit_code)
        return TerminalObservation(TerminalState.RUNNING)

    def capture_screen(self, agent_run_id: str) -> bytes:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        if terminal.observation_error is not None:
            raise TerminalObservationError(
                f"could not capture terminal for AgentRun {agent_run_id}"
            ) from terminal.observation_error
        with terminal.lock:
            return bytes(terminal.screen)

    def submit_text(self, agent_run_id: str, text: str) -> None:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        with terminal.lock:
            terminal.submitted_text.append(text)
            terminal.output.extend(text.encode("utf-8") + b"\n")
            terminal.screen.extend(text.encode("utf-8") + b"\n")

    def stage_text(self, agent_run_id: str, text: str) -> None:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        with terminal.lock:
            terminal.staged_text.append(text)
            terminal.output.extend(text.encode("utf-8"))
            terminal.screen.extend(text.encode("utf-8"))

    def submitted_text(self, agent_run_id: str) -> tuple[str, ...]:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        with terminal.lock:
            return tuple(terminal.submitted_text)

    def staged_text(self, agent_run_id: str) -> tuple[str, ...]:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        with terminal.lock:
            return tuple(terminal.staged_text)

    def terminate(self, agent_run_id: str) -> TerminationResult:
        with self._lock:
            terminal = self._terminals.pop(agent_run_id, None)
            if terminal is None:
                return TerminationResult(was_present=False)
            attachments = tuple(terminal.attachments)
        for attachment in attachments:
            attachment.detach()
        return TerminationResult(was_present=True)

    def finish(self, agent_run_id: str, exit_code: int | None = None) -> None:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        terminal.exited = True
        terminal.exit_code = exit_code

    def fail_observation(self, agent_run_id: str, error: Exception) -> None:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        terminal.observation_error = error

    def feed_output(self, agent_run_id: str, data: bytes) -> None:
        terminal = self._terminals.get(agent_run_id)
        if terminal is None:
            raise TerminalNotFound(agent_run_id)
        with terminal.lock:
            terminal.output.extend(data)
            terminal.screen.extend(data)
