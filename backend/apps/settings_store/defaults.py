"""Compatibility import for callers that previously read prompt seeds here.

WorkTracker owns the explicit project seed data; this stable import path lets the
terminal composition migrate without duplicating those values.
"""

from worktracker.launch_seeds import DEFAULT_AGENT_PROMPTS

__all__ = ["DEFAULT_AGENT_PROMPTS"]
