from worktracker.reviewed_defaults import (
    REVIEWED_STATES,
    REVIEWED_TASK_ISSUE_TYPES,
)


GROUP_CHOICES = [
    ("backlog", "Backlog"),
    ("unstarted", "Unstarted"),
    ("started", "Started"),
    ("completed", "Completed"),
    ("cancelled", "Cancelled"),
]

TYPE_CHOICES = [
    ("module", "Module"),
    ("task", "Task"),
]

LEVEL_CHOICES = TYPE_CHOICES

# The canonical workflow in exact left-to-right board order. Each entry is
# ``(name, group, color)`` and is projected from the reviewed defaults artifact.
DEFAULT_STATES = list(REVIEWED_STATES)

# IBM Carbon's 14-color dark categorical palette, in the published sequence.
# Runtime workflow-state color assignment draws from this project-scoped pool.
CARBON_DARK_PALETTE = (
    "#8A3FFC",
    "#33B1FF",
    "#007D79",
    "#FF7EB6",
    "#FA4D56",
    "#FFF1F1",
    "#6FDC8C",
    "#4589FF",
    "#D12771",
    "#D2A106",
    "#08BDBA",
    "#BAE6FF",
    "#BA4E00",
    "#D4BBFF",
)

# All canonical workflow states are protected (non-deletable). Matched by
# ``(name, group)`` in ``seed.ensure_protected_states``.
PROTECTED_STATE_KEYS = {(name, group) for name, group, _ in DEFAULT_STATES}

# The canonical issue types (CODIN-859, CODIN-954). The module/container type
# remains model-owned; task-level work kinds and their order come from the
# reviewed defaults artifact.
DEFAULT_ISSUE_TYPES = [
    ("Module", "module"),
    *[(name, "task") for name in REVIEWED_TASK_ISSUE_TYPES],
]
