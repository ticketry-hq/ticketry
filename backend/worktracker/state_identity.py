"""Workflow-state identity helpers shared by persistence and event detection."""


def normalize_state_id(value):
    """Normalize UUID/string/None state ids for stable identity comparison."""

    return str(value) if value is not None else None
