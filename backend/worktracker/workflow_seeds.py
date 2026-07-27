"""Upgrade-only templates for materializing the historical SDLC workflows.

Runtime transition code must not import this module.  These name-based
templates exist only to turn the workflows shipped before configurable graphs
into explicit project-owned rows during migration and project creation.
"""

DEFAULT_WORKFLOW_TEMPLATES = {
    "Story": {
        "start": "Idea",
        "transitions": {
            "Idea": ("Refinement", "Cancelled"),
            "Refinement": ("Ready", "Cancelled"),
            "Ready": ("Implement", "Cancelled"),
            "Implement": ("Review", "Cancelled"),
            "Review": ("Implement", "Done", "Cancelled"),
            "Done": (),
            "Cancelled": (),
        },
    },
    "Implementation": {
        "start": "Ready",
        "transitions": {
            "Ready": ("Implement", "Cancelled"),
            "Implement": ("Review", "Cancelled"),
            "Review": ("Implement", "Done", "Cancelled"),
            "Done": (),
            "Cancelled": (),
        },
    },
    "PathFind": {
        "start": "Refinement",
        "transitions": {
            "Refinement": ("Done", "Cancelled"),
            "Done": (),
            "Cancelled": (),
        },
    },
}
