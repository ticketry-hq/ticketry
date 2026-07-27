"""Internal tmux package for terminal sessions.

Application code should use :mod:`apps.terminals.session` instead of importing
this package directly. Tests for tmux internals may import the concrete
submodules.
"""

from __future__ import annotations

from apps.terminals.tmux._core import SESSION_PREFIX, TMUX_SOCKET, TmuxSessionError
from apps.terminals.tmux.metadata import TmuxSession
from apps.terminals.tmux.sessions import ReconcileResult


__all__ = [
    "SESSION_PREFIX",
    "TMUX_SOCKET",
    "TmuxSessionError",
    "TmuxSession",
    "ReconcileResult",
]
