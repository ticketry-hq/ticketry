from django.db import migrations, models


IDEA_PROMPT = """This task is in `Idea`: The user has typed in a thought with stream of consciousness writing style.
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
- Move it to "Refinement" state."""

OLD_REFINEMENT_PROMPT = """This task is in `Refinement`, where an idea is turned into a committed, dependency-ordered plan through agent-driven discovery.

This is what you need to do in this ticket:
1. Use the /grill-me-with-docs or the $grill-me-with-docs skill to finalize requirements.
2. Use the /to-spec or $to-spec and generate spec, add the link to the spec in the story.
3. Use to /to-tickets or $to-tickets skill to generated tickets. Create the tickets as Implementation subtasks.

Move the story to Ready state.
Stop after this, don't implement."""

REFINEMENT_PROMPT = OLD_REFINEMENT_PROMPT.replace(
    "grill-me-with-docs", "grill-with-docs"
)


def seed_required_skills(apps, schema_editor):
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    LaunchBinding.objects.filter(
        state__name="Idea",
        prompt=IDEA_PROMPT,
    ).update(required_skills=["to-spec", "to-tickets"])
    LaunchBinding.objects.filter(
        state__name="Refinement",
        prompt=OLD_REFINEMENT_PROMPT,
    ).update(
        prompt=REFINEMENT_PROMPT,
        required_skills=["grill-with-docs", "to-spec", "to-tickets"],
    )


def unseed_required_skills(apps, schema_editor):
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    LaunchBinding.objects.filter(
        state__name="Idea",
        prompt=IDEA_PROMPT,
        required_skills=["to-spec", "to-tickets"],
    ).update(required_skills=[])
    LaunchBinding.objects.filter(
        state__name="Refinement",
        prompt=REFINEMENT_PROMPT,
        required_skills=["grill-with-docs", "to-spec", "to-tickets"],
    ).update(prompt=OLD_REFINEMENT_PROMPT, required_skills=[])


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0027_launch_binding_subtree_run")]

    operations = [
        migrations.AddField(
            model_name="launchbinding",
            name="required_skills",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(seed_required_skills, unseed_required_skills),
    ]
