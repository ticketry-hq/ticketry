"""Launch-prompt seeds from ``worktracker/reviewed_defaults.json``.

The artifact is read once at import time and materialized as project-owned
launch bindings. Existing bindings remain authoritative on later seed passes.
"""

from worktracker.reviewed_defaults import REVIEWED_DEFAULTS


# The one prompt with no reviewed per-state equivalent: the fallback used when a
# project defines a state the reviewed defaults do not cover.
_LEGACY_DEFAULT_PROMPT = """Follow AGENTS.md exactly when this prompt is launched from a work item. Highest priority is readability. Do not extend functionality, integrate new interfaces, or touch unrelated modules; keep changes local to the requested file or module, explore the local repo first, and use the current module folder as the working directory. This is an SDLC workflow whose states and legal moves between them are configured per project, not fixed here. Advance state only through the coding agent's status tool, and only when the active stage guidance explicitly requests a legal move; completing a phase does not imply automatic promotion. Never leave a ticket in an earlier phase when the active stage guidance requires advancing after its deliverable is complete. Blockedness is expressed only by dependency edges - there is no `Blocked` state. If work is trivial, keep the deliverables proportionate while following the configured workflow edges."""


DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE = REVIEWED_DEFAULTS["prompts"]
DEFAULT_AUTO_START_BY_STATE = {
    state["name"]: state.get("autoStart", False)
    for state in REVIEWED_DEFAULTS["states"]
}
DEFAULT_ENTRY_SKILL_BY_STATE = REVIEWED_DEFAULTS["entrySkills"]

# Compatibility for older callers that only understand one prompt per state.
# Story is the canonical task type and therefore remains the legacy projection.
DEFAULT_AGENT_PROMPTS = {
    "default": _LEGACY_DEFAULT_PROMPT,
    **DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE["Story"],
}


def default_agent_prompt(issue_type_name: str, state_name: str) -> str:
    """Return the reviewed seed for an issue type/state pair."""

    prompts = DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE.get(
        issue_type_name,
        DEFAULT_AGENT_PROMPTS,
    )
    return prompts.get(
        state_name,
        DEFAULT_AGENT_PROMPTS.get(state_name, DEFAULT_AGENT_PROMPTS["default"]),
    )
