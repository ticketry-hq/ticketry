"""Deep terminal-runtime seam.

Only AgentRun IDs cross this boundary. Durable-session naming, tmux commands,
PTY processes, provider policy, and application persistence remain private or
outside the module.
"""

from ._contract import (
    CreateTerminal,
    TerminalAlreadyExists,
    TerminalAttachment,
    TerminalDimensions,
    TerminalNotFound,
    TerminalObservation,
    TerminalObservationError,
    TerminalRuntime,
    TerminalRuntimeError,
    TerminalState,
    TerminationResult,
)
from ._fake import InMemoryTerminalRuntime
from ._tmux import TmuxTerminalRuntime


__all__ = [
    "CreateTerminal",
    "InMemoryTerminalRuntime",
    "TerminalAlreadyExists",
    "TerminalAttachment",
    "TerminalDimensions",
    "TerminalNotFound",
    "TerminalObservation",
    "TerminalObservationError",
    "TerminalRuntime",
    "TerminalRuntimeError",
    "TerminalState",
    "TerminationResult",
    "TmuxTerminalRuntime",
]
