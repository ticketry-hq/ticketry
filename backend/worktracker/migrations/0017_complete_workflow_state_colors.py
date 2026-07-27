"""Complete persisted workflow-state colors without rewriting configured values.

Blank canonical states regain the Studio mapping. Every other blank state uses
an unused IBM Carbon dark categorical color, without replacement per project.
The migration preflights all projects before writing so palette exhaustion can
never leave a project partially backfilled.
"""

from django.db import migrations


CANONICAL_COLORS = {
    "Idea": "#60646C",
    "Refinement": "#8E4EC6",
    "Ready": "#0091FF",
    "Implement": "#F59E0B",
    "Review": "#D6409F",
    "Done": "#46A758",
    "Cancelled": "#9AA4BC",
}

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


def complete_state_colors(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    State = apps.get_model("worktracker", "State")
    alias = schema_editor.connection.alias

    plans = []
    for project in Project.objects.using(alias).order_by("created_at"):
        states = list(
            State.objects.using(alias)
            .filter(project=project)
            .order_by("created_at", "id")
        )
        configured = [state for state in states if (state.color or "").strip()]
        canonical_blanks = [
            state
            for state in states
            if not (state.color or "").strip() and state.name in CANONICAL_COLORS
        ]
        custom_blanks = [
            state
            for state in states
            if not (state.color or "").strip() and state.name not in CANONICAL_COLORS
        ]

        used = {state.color.casefold() for state in configured}
        used.update(
            CANONICAL_COLORS[state.name].casefold() for state in canonical_blanks
        )
        available = [
            color for color in CARBON_DARK_PALETTE if color.casefold() not in used
        ]
        if len(custom_blanks) > len(available):
            raise RuntimeError(
                "Cannot backfill workflow-state colors for project "
                f"{project.slug} ({project.id}): {len(custom_blanks)} blank "
                "non-canonical states require automatic colors but only "
                f"{len(available)} unused IBM Carbon colors remain."
            )
        plans.append((canonical_blanks, custom_blanks, available))

    for canonical_blanks, custom_blanks, available in plans:
        for state in canonical_blanks:
            state.color = CANONICAL_COLORS[state.name]
            state.save(using=alias, update_fields=["color"])
        for state, color in zip(custom_blanks, available):
            state.color = color
            state.save(using=alias, update_fields=["color"])


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0016_workflow_configuration"),
    ]

    operations = [
        migrations.RunPython(
            complete_state_colors,
            migrations.RunPython.noop,
            atomic=True,
        ),
    ]
