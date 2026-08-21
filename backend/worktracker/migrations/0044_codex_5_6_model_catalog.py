import uuid

from django.db import migrations


CODEX_MODEL_REASONING = {
    "gpt-5.6-sol": ("low", "medium", "high", "xhigh", "max", "ultra"),
    "gpt-5.6-terra": ("low", "medium", "high", "xhigh", "max", "ultra"),
    "gpt-5.6-luna": ("low", "medium", "high", "xhigh", "max"),
}


def reconcile_codex_5_6_catalog(apps, schema_editor):
    Provider = apps.get_model("worktracker", "Provider")
    AgentModel = apps.get_model("worktracker", "AgentModel")
    ReasoningLevel = apps.get_model("worktracker", "ReasoningLevel")
    AgentModelReasoningLevel = apps.get_model("worktracker", "AgentModelReasoningLevel")
    alias = schema_editor.connection.alias

    codex = Provider.objects.using(alias).get(slug="codex")
    level_names = {name for names in CODEX_MODEL_REASONING.values() for name in names}
    levels = {}
    for name in level_names:
        levels[name], _ = ReasoningLevel.objects.using(alias).get_or_create(
            name=name,
            defaults={"id": uuid.uuid4()},
        )

    for model_name, reasoning_names in CODEX_MODEL_REASONING.items():
        agent_model, _ = AgentModel.objects.using(alias).get_or_create(
            provider=codex,
            name=model_name,
            defaults={"id": uuid.uuid4()},
        )
        AgentModelReasoningLevel.objects.using(alias).filter(
            agent_model=agent_model
        ).exclude(reasoning_level__name__in=reasoning_names).delete()
        AgentModelReasoningLevel.objects.using(alias).bulk_create(
            [
                AgentModelReasoningLevel(
                    agent_model=agent_model,
                    reasoning_level=levels[name],
                )
                for name in reasoning_names
            ],
            ignore_conflicts=True,
        )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0043_story_run_now_workflow")]

    operations = [
        migrations.RunPython(
            reconcile_codex_5_6_catalog,
            migrations.RunPython.noop,
        )
    ]
