"""Reviewed defaults for project-owned launch prompt configuration."""

import json
from importlib.resources import files


_LEGACY_AGENT_PROMPTS = {
    "default": """Follow AGENTS.md exactly when this prompt is launched from a work item. Highest priority is readability. Do not extend functionality, integrate new interfaces, or touch unrelated modules; keep changes local to the requested file or module, explore the local repo first, and use the current module folder as the working directory. This is the SDLC workflow: `Idea -> Refinement -> Ready -> Implement -> Review -> Done`, with `Cancelled` the terminal off-ramp for dropped work. Advance state only through the coding agent's status tool, and only when the active stage guidance explicitly requests a legal move; completing a phase does not imply automatic promotion. Never leave a ticket in an earlier phase when the active stage guidance requires advancing after its deliverable is complete. Blockedness is expressed only by dependency edges - there is no `Blocked` state. If work is trivial enough to skip ceremony, say so; skipping ceremony requires an explicit audited `force` rather than half-doing a phase.""",
    "Idea": """This task is in `Idea`: The user has typed in a thought with stream of consciousness writing style.
This may or may not contain a coherent idea. Your job is to make sense of it with the codebase context you have.

Refine step:
1. Based on the user's description, explore the codebase and find relevant files and make sense of the ask.
2. Update the title based on your understanding using the MCP server.

After this, we decide, do we have enough to just make the change or if further refinement is required.
Case "small change" && "no refinement needed":
- Use the skill 'to-spec' to write a spec for the ask with the relevant files the next agent should look at.
- Use the skill 'to-tickets' to split the task into tickets.
- Create those tickets as 'Implementation' tickets using the MCP under the main task.
- Move the story over to 'Ready' state for the user to prioritize and execute when required.

Case "large change" || "needs refinement":
- Append the paths to the relevant files to the ticket
- Move it to "Refinement" state.""",
    "Refinement": """This task is in `Refinement`, where an idea is turned into a committed, dependency-ordered plan through agent-driven discovery.

This is what you need to do in this ticket:
1. Use the /grill-with-docs or the $grill-with-docs skill to finalize requirements.
2. Use the /to-spec or $to-spec and generate spec, add the link to the spec in the story.
3. Use to /to-tickets or $to-tickets skill to generated tickets. Create the tickets as Implementation subtasks.

Move the story to Ready state.
Stop after this, don't implement.""",
    "Ready": """This task is in `Ready`: refined work queued until implementation capacity is assigned. Do not implement anything - `Ready` is a prioritization queue, not an implementation phase. If launched here, use the time to *verify the promise of `Ready`* and report: for a **Story**, confirm the spec and HLD exist in its design directory, that Implementation children exist, and that their dependency edges form a DAG, and flag anything missing; for an **Implementation child**, confirm its scope and its `blocked_by` edges read correctly. Then report the verification and stop; verification does not itself request or trigger entering `Implement`.""",
    "Implement": """This task is in `Implement`: **What you do depends on this ticket's Type.**

**If this is an Implementation child:** implement only this child's agreed slice, from its spec and the parent's HLD. Keep changes local, avoid unrelated edits, and validate the touched behaviour before finishing. You are running because your dependencies are satisfied - do not start work that a `blocked_by` edge still gates. When the slice is complete and validated, move **this child** to `Review` so the review step is triggered by the work itself. If you are blocked, say so and leave it in `Implement`.

**If this is a Story:** the implementation campaign is running across your Implementation children; your job is coordination and integration, not re-implementing the children. Do not move the story yourself - it advances to `Review` on its own once every Implementation child is terminal and at least one is `Done`. Surface cross-child integration problems as they appear.
If there are no implementation stories under this, then implement the story itself.

For dependencies, treat 'Review' state as unblocked.""",
    "Review": """This task is in `Review`. **What you do depends on this ticket's Type.**

**If this is an Implementation child:** run `code-review` over this child's changes and report findings plainly. The review deliverable is the findings; completing it does not itself request or trigger a move to `Done`.

**If this is a Story:** review the *combined* result of all children together, looking for integration issues that per-child review cannot catch. Turn each actionable finding into a new **Implementation** child through the dedicated `create_review_finding` tool - it creates the child directly in `Ready`, parented to this Story, carrying a fixed `Path` (repo-relative file) / inclusive `Lines` (start-end) / optional `Note` evidence block, so fixes rejoin the same execution machinery. Do not draw a `blocked_by` dependency edge and do not fix findings inline here; returning to `Implement` is outside this review deliverable. Final acceptance must be explicitly requested; do not infer it from a clean review. It requires a PR linked to the story. When final acceptance is requested, finalize atomically: commit the worktree changes, open a PR, link it to the story, clean up the worktree, and only then request the `Review -> Done` transition; if any step fails, stay in `Review` and report the exact error rather than advancing.""",
}


_REVIEWED_DEFAULTS = json.loads(
    files("worktracker").joinpath("reviewed_defaults.json").read_text(encoding="utf-8")
)
DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE = _REVIEWED_DEFAULTS["prompts"]

# Compatibility for older callers that only understand one prompt per state.
# Story is the canonical task type and therefore remains the legacy projection.
DEFAULT_AGENT_PROMPTS = {
    "default": _LEGACY_AGENT_PROMPTS["default"],
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
