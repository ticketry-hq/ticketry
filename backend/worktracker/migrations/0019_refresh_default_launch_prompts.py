from django.db import migrations


OLD_AGENT_PROMPTS = {
    "Idea": """This task is in `Idea`: a rough capture that must be made workable and self-contained without re-explaining it later, using limited local discovery only—inspect just enough of the repo to identify affected code/module surfaces and make the capture understandable. The only ticket mutation in this phase's deliverable is updating its name to a crisp summary and its description to be self-contained: intent, observed behaviour, relevant files/paths, constraints, and acceptance signals. Do not implement code. Do not create design artifacts or design documents, child work items, or dependency edges. Deeper discovery, requirements work, planning artifacts, children, and the dependency-ordered plan belong to the later `Refinement` phase—do not do Refinement's job here. Ask the user only what limited exploration cannot answer. When the idea is workable, report that the capture deliverable is complete; completion does not itself request or trigger a state transition.""",
    "Refinement": """This task is in `Refinement`. Use ONLY the `grill-with-docs` skill to stress-test and sharpen the idea through one focused conversation. Explore the codebase when a factual question can be answered there; ask the user one decision question at a time and include your recommended answer. Do not create child work items, split discovery into explorer tasks, or delegate work to subagents. Do not implement product code. Capture the decisions and documentation produced by the skill as you go. When shared understanding is confirmed, summarize the refined plan and report that the phase deliverable is complete; completion does not itself request or trigger a state transition.""",
    "Implement": """This task is in `Implement`. **What you do depends on this ticket's Type.**

**If this is an Implementation child:** implement only this child's agreed slice, from its spec and the parent's HLD. Keep changes local, avoid unrelated edits, and validate the touched behaviour before finishing. You are running because your dependencies are satisfied - do not start work that a `blocked_by` edge still gates. When the slice is complete and validated, move **this child** to `Review` so the review step is triggered by the work itself. If you are blocked, say so and leave it in `Implement`.

**If this is a Story:** the implementation campaign is running across your Implementation children; your job is coordination and integration, not re-implementing the children. This coordinating run has no Story state-change deliverable. Treat the campaign as complete only once every Implementation child is terminal and at least one is `Done`. Surface cross-child integration problems as they appear.""",
}

NEW_AGENT_PROMPTS = {
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
1. Use the /grill-me-with-docs or the $grill-me-with-docs skill to finalize requirements.
2. Use the /to-spec or $to-spec and generate spec, add the link to the spec in the story.
3. Use to /to-tickets or $to-tickets skill to generated tickets. Create the tickets as Implementation subtasks.

Move the story to Ready state.
Stop after this, don't implement.""",
    "Implement": """This task is in `Implement`: **What you do depends on this ticket's Type.**

**If this is an Implementation child:** implement only this child's agreed slice, from its spec and the parent's HLD. Keep changes local, avoid unrelated edits, and validate the touched behaviour before finishing. You are running because your dependencies are satisfied - do not start work that a `blocked_by` edge still gates. When the slice is complete and validated, move **this child** to `Review` so the review step is triggered by the work itself. If you are blocked, say so and leave it in `Implement`.

**If this is a Story:** the implementation campaign is running across your Implementation children; your job is coordination and integration, not re-implementing the children. Do not move the story yourself - it advances to `Review` on its own once every Implementation child is terminal and at least one is `Done`. Surface cross-child integration problems as they appear.
If there are no implementation stories under this, then implement the story itself.

For dependencies, treat 'Review' state as unblocked.""",
}


def refresh_default_prompts(apps, schema_editor):
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    bindings = LaunchBinding.objects.using(schema_editor.connection.alias)
    for state_name, old_prompt in OLD_AGENT_PROMPTS.items():
        bindings.filter(
            state__name=state_name,
            prompt=old_prompt,
        ).update(prompt=NEW_AGENT_PROMPTS[state_name])


def restore_default_prompts(apps, schema_editor):
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    bindings = LaunchBinding.objects.using(schema_editor.connection.alias)
    for state_name, old_prompt in OLD_AGENT_PROMPTS.items():
        bindings.filter(
            state__name=state_name,
            prompt=NEW_AGENT_PROMPTS[state_name],
        ).update(prompt=old_prompt)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0018_launch_binding")]

    operations = [
        migrations.RunPython(refresh_default_prompts, restore_default_prompts),
    ]
