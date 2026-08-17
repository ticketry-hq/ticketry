"""Public, persistence-free contract for durable terminal runtimes."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Mapping, Protocol, runtime_checkable


@dataclass(frozen=True)
class TerminalDimensions:
    """Terminal geometry in columns and rows."""

    columns: int
    rows: int

    def __post_init__(self) -> None:
        if self.columns < 1 or self.rows < 1:
            raise ValueError("terminal dimensions must be positive")


@dataclass(frozen=True)
class CreateTerminal:
    """Fully prepared mechanical inputs for one durable runtime."""

    agent_run_id: str
    command: str
    working_directory: str | Path
    environment: Mapping[str, str]
    dimensions: TerminalDimensions


class TerminalState(str, Enum):
    RUNNING = "running"
    EXITED = "exited"
    MISSING = "missing"


@dataclass(frozen=True)
class TerminalObservation:
    state: TerminalState
    exit_code: int | None = None

    def __post_init__(self) -> None:
        if self.state is not TerminalState.EXITED and self.exit_code is not None:
            raise ValueError("only exited terminals may carry an exit code")


@dataclass(frozen=True)
class TerminationResult:
    was_present: bool


class TerminalRuntimeError(RuntimeError):
    """Base error raised by terminal runtime mechanics."""


class TerminalAlreadyExists(TerminalRuntimeError):
    """A runtime already exists for this AgentRun ID."""


class TerminalNotFound(TerminalRuntimeError):
    """No runtime exists for this AgentRun ID."""


class TerminalObservationError(TerminalRuntimeError):
    """The runtime could not determine terminal state with confidence."""


@runtime_checkable
class TerminalAttachment(Protocol):
    """A transient, transport-independent viewer of a durable terminal."""

    def read(self, size: int = 4096) -> bytes: ...

    def write(self, data: bytes) -> None: ...

    def resize(self, dimensions: TerminalDimensions) -> None: ...

    def scroll(self, direction: str, lines: int = 3) -> None: ...

    @property
    def completed(self) -> bool: ...

    def wait(self) -> int | None: ...

    def detach(self) -> None: ...


@runtime_checkable
class TerminalRuntime(Protocol):
    """The only application-facing seam for terminal mechanics."""

    @property
    def namespace(self) -> str:
        """Stable identity of the runtime inventory owned by this instance."""
        ...

    @property
    def legacy_namespaces(self) -> tuple[str, ...]:
        """Former identities that this runtime may safely prove and adopt."""
        ...

    def create(self, request: CreateTerminal) -> None: ...

    def attach(self, agent_run_id: str) -> TerminalAttachment: ...

    def inspect(self, agent_run_id: str) -> TerminalObservation: ...

    def capture_screen(self, agent_run_id: str) -> bytes:
        """Return the durable session's currently rendered screen.

        A mechanical read, deterministic for an unchanged screen so callers can
        tell a genuinely changed output from an unchanged redraw. It carries no
        judgement about the run and is never persisted by the runtime.
        """
        ...

    def terminate(self, agent_run_id: str) -> TerminationResult: ...
