"""Terminal output activity: the durable evidence that output changed.

Independent of provider lifecycle hooks, viewer transport health, and hosted
command exit. This package owns the compact identity, its persistence, the one
shared application operation adapters report to, the streaming observer that
turns a byte pump into coalesced observations, the native renderer's report of
the same observation for terminals whose bytes Ticketry never sees, and the
viewer-independent sweep that keeps unwatched live sessions observed.
"""

from apps.terminals.output_activity.capture import observe_terminal_output
from apps.terminals.output_activity.identity import output_identity
from apps.terminals.output_activity.live_sweep import (
    observe_live_sessions,
    start_live_output_sweep,
    stop_live_output_sweep,
)
from apps.terminals.output_activity.native_reports import report_native_output
from apps.terminals.output_activity.observation import record_terminal_output
from apps.terminals.output_activity.stream_observer import TerminalOutputObserver


__all__ = [
    "TerminalOutputObserver",
    "observe_live_sessions",
    "observe_terminal_output",
    "output_identity",
    "record_terminal_output",
    "report_native_output",
    "start_live_output_sweep",
    "stop_live_output_sweep",
]
