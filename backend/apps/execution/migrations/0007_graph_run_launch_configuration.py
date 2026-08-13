from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("execution", "0006_graphrun_execution_mode")]

    operations = [
        migrations.AddField(
            model_name="graphrun",
            name="launch_configuration",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="LaunchPolicyEffect",
            fields=[
                (
                    "decision_id",
                    models.CharField(max_length=32, primary_key=True, serialize=False),
                ),
                ("caller_scope", models.CharField(max_length=32)),
                ("idempotency_key", models.CharField(max_length=255)),
                ("result", models.JSONField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "launch_policy_effects"},
        ),
        migrations.AddConstraint(
            model_name="launchpolicyeffect",
            constraint=models.UniqueConstraint(
                fields=("caller_scope", "idempotency_key"),
                name="uniq_launch_policy_effect_identity",
            ),
        ),
    ]
