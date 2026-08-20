from django.db import migrations, models


ENTRY_SKILLS = {
    "Grill": "grill-with-docs",
    "Spec": "to-spec",
    "Tickets": "to-tickets",
}
REVIEWED_ISSUE_TYPES = {"Story", "PathFind", "Implementation"}


def seed_reviewed_entry_skills(apps, schema_editor):
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    bindings = (
        LaunchBinding.objects.using(schema_editor.connection.alias)
        .filter(
            issue_type__name__in=REVIEWED_ISSUE_TYPES,
            state__name__in=ENTRY_SKILLS,
        )
        .select_related("state")
    )
    for binding in bindings:
        entry_skill = ENTRY_SKILLS[binding.state.name]
        if entry_skill in (binding.required_skills or ()):
            binding.entry_skill = entry_skill
            binding.save(update_fields=["entry_skill"])


def unseed_reviewed_entry_skills(apps, schema_editor):
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    LaunchBinding.objects.using(schema_editor.connection.alias).filter(
        issue_type__name__in=REVIEWED_ISSUE_TYPES,
        state__name__in=ENTRY_SKILLS,
        entry_skill__in=ENTRY_SKILLS.values(),
    ).update(entry_skill=None)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0046_remove_workspace")]

    operations = [
        migrations.AddField(
            model_name="launchbinding",
            name="entry_skill",
            field=models.CharField(
                blank=True,
                default=None,
                max_length=128,
                null=True,
            ),
        ),
        migrations.RunPython(
            seed_reviewed_entry_skills,
            unseed_reviewed_entry_skills,
        ),
    ]
