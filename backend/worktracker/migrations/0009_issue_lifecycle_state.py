from django.db import migrations, models


# Historical migration state must not import a runtime constant that can be
# retired after this field is removed.
LIFECYCLE_CHOICES = [
    ("backlog", "Backlog"),
    ("refining", "Refining"),
    ("prd_generated", "PRD generated"),
    ("prd_review", "PRD in review"),
    ("prd_approved", "PRD approved"),
    ("generating_hld", "Generating HLD"),
    ("hld_generated", "HLD generated"),
    ("hld_review", "HLD in review"),
    ("hld_approved", "HLD approved"),
    ("registering_split", "Registering split"),
    ("split_created", "Split created"),
    ("lld_generating", "Generating LLD"),
    ("lld_generated", "LLD generated"),
    ("lld_review", "LLD in review"),
    ("lld_approved", "LLD approved"),
    ("implementing", "Implementing"),
    ("done", "Done"),
    ("failed", "Failed"),
    ("cancelled", "Cancelled"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("worktracker", "0008_state_is_protected_and_blocked"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="lifecycle_state",
            field=models.CharField(
                max_length=32,
                choices=LIFECYCLE_CHOICES,
                null=True,
                blank=True,
                default=None,
            ),
        ),
    ]
