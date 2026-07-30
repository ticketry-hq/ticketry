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

# The internal planning-lifecycle axis (#758), separate from the visible
# ``Issue.state`` FK. 19 values, one guarded machine (see ``worktracker.lifecycle``);
# ``max_length=32`` covers the longest value. Written only through
# ``lifecycle.set_lifecycle``; never client-writable via CRUD.
LIFECYCLE_CHOICES = [
    ("backlog", "Backlog"),
    ("refining", "Refining"),
    ("prd_generated", "PRD generated"),
    ("prd_review", "PRD in review"),
    ("prd_approved", "PRD approved"),
    ("generating_hld", "Generating HLD"),
    ("hld_generated", "HLD generated"),
    ("hld_review", "HLD in review"),
    ("hld_approved", "HLD approved"),
    ("registering_split", "Registering split"),
    ("split_created", "Split created"),
    ("lld_generating", "Generating LLD"),
    ("lld_generated", "LLD generated"),
    ("lld_review", "LLD in review"),
    ("lld_approved", "LLD approved"),
    ("implementing", "Implementing"),
    ("done", "Done"),
    ("failed", "Failed"),
    ("cancelled", "Cancelled"),
]

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

# All seven canonical workflow states are protected (non-deletable). Matched by
# ``(name, group)`` in ``seed.ensure_protected_states``.
PROTECTED_STATE_KEYS = {(name, group) for name, group, _ in DEFAULT_STATES}

# The canonical issue types (CODIN-859, CODIN-954). The module/container type
# remains model-owned; task-level work kinds and their order come from the
# reviewed defaults artifact. The artifact's first task type is the default.
DEFAULT_ISSUE_TYPES = [
    ("Module", "module", True),
    *[
        (name, "task", index == 0)
        for index, name in enumerate(REVIEWED_TASK_ISSUE_TYPES)
    ],
]
