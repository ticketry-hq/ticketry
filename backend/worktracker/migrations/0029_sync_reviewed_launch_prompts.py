import importlib

from django.db import migrations

from worktracker.launch_seeds import DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE


prompt_refresh = importlib.import_module(
    "worktracker.migrations.0019_refresh_default_launch_prompts"
)
PREVIOUS_DEFAULT_PROMPTS = {
    "Idea": prompt_refresh.NEW_AGENT_PROMPTS["Idea"],
    "Refinement": prompt_refresh.NEW_AGENT_PROMPTS["Refinement"].replace(
        "grill-me-with-docs", "grill-with-docs"
    ),
    "Ready": """This task is in `Ready`: refined work queued until implementation capacity is assigned. Do not implement anything - `Ready` is a prioritization queue, not an implementation phase. If launched here, use the time to *verify the promise of `Ready`* and report: for a **Story**, confirm the spec and HLD exist in its design directory, that Implementation children exist, and that their dependency edges form a DAG, and flag anything missing; for an **Implementation child**, confirm its scope and its `blocked_by` edges read correctly. Then report the verification and stop; verification does not itself request or trigger entering `Implement`.""",
    "Implement": prompt_refresh.NEW_AGENT_PROMPTS["Implement"],
    "Review": """This task is in `Review`. **What you do depends on this ticket's Type.**

**If this is an Implementation child:** run `code-review` over this child's changes and report findings plainly. The review deliverable is the findings; completing it does not itself request or trigger a move to `Done`.

**If this is a Story:** review the *combined* result of all children together, looking for integration issues that per-child review cannot catch. Turn each actionable finding into a new **Implementation** child through the dedicated `create_review_finding` tool - it creates the child directly in `Ready`, parented to this Story, carrying a fixed `Path` (repo-relative file) / inclusive `Lines` (start-end) / optional `Note` evidence block, so fixes rejoin the same execution machinery. Do not draw a `blocked_by` dependency edge and do not fix findings inline here; returning to `Implement` is outside this review deliverable. Final acceptance must be explicitly requested; do not infer it from a clean review. It requires a PR linked to the story. When final acceptance is requested, finalize atomically: commit the worktree changes, open a PR, link it to the story, clean up the worktree, and only then request the `Review -> Done` transition; if any step fails, stay in `Review` and report the exact error rather than advancing.""",
    "Done": """Follow AGENTS.md exactly when this prompt is launched from a work item. Highest priority is readability. Do not extend functionality, integrate new interfaces, or touch unrelated modules; keep changes local to the requested file or module, explore the local repo first, and use the current module folder as the working directory. This is the SDLC workflow: `Idea -> Refinement -> Ready -> Implement -> Review -> Done`, with `Cancelled` the terminal off-ramp for dropped work. Advance state only through the coding agent's status tool, and only when the active stage guidance explicitly requests a legal move; completing a phase does not imply automatic promotion. Never leave a ticket in an earlier phase when the active stage guidance requires advancing after its deliverable is complete. Blockedness is expressed only by dependency edges - there is no `Blocked` state. If work is trivial enough to skip ceremony, say so; skipping ceremony requires an explicit audited `force` rather than half-doing a phase.""",
    "Cancelled": """Follow AGENTS.md exactly when this prompt is launched from a work item. Highest priority is readability. Do not extend functionality, integrate new interfaces, or touch unrelated modules; keep changes local to the requested file or module, explore the local repo first, and use the current module folder as the working directory. This is the SDLC workflow: `Idea -> Refinement -> Ready -> Implement -> Review -> Done`, with `Cancelled` the terminal off-ramp for dropped work. Advance state only through the coding agent's status tool, and only when the active stage guidance explicitly requests a legal move; completing a phase does not imply automatic promotion. Never leave a ticket in an earlier phase when the active stage guidance requires advancing after its deliverable is complete. Blockedness is expressed only by dependency edges - there is no `Blocked` state. If work is trivial enough to skip ceremony, say so; skipping ceremony requires an explicit audited `force` rather than half-doing a phase.""",
}


def sync_reviewed_prompts(apps, schema_editor):
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    for issue_type_name, prompts in DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE.items():
        for state_name, reviewed_prompt in prompts.items():
            previous_prompt = PREVIOUS_DEFAULT_PROMPTS.get(state_name)
            if previous_prompt is None:
                continue
            LaunchBinding.objects.filter(
                issue_type__name=issue_type_name,
                issue_type__level="task",
                state__name=state_name,
                prompt=previous_prompt,
            ).update(prompt=reviewed_prompt)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0028_launch_binding_required_skills")]

    operations = [
        migrations.RunPython(sync_reviewed_prompts, migrations.RunPython.noop),
    ]
