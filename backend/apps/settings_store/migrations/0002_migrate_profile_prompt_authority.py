from django.db import migrations


def migrate_prompt_authority(apps, schema_editor):
    from apps.settings_store.local_state_migration import CONFIG_DIR
    from apps.settings_store.profile_prompt_migration import migrate_profile_prompts

    migrate_profile_prompts(
        CONFIG_DIR / "profiles.json",
        Workspace=apps.get_model("worktracker", "Workspace"),
        LaunchBinding=apps.get_model("worktracker", "LaunchBinding"),
    )


class Migration(migrations.Migration):
    dependencies = [
        ("settings_store", "0001_initial"),
        ("worktracker", "0020_seed_workflow_configurations"),
    ]

    operations = [
        migrations.RunPython(migrate_prompt_authority, migrations.RunPython.noop),
    ]
