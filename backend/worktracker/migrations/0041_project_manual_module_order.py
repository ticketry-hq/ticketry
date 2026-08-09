from django.db import migrations, models


class Migration(migrations.Migration):
    """Give every project an explicit module ordering mode (#359).

    The field is added with the automatic-mode default, so existing projects
    keep today's behavior. No module ``rank`` is written or rewritten here:
    ranks are ignored for module ordering until a project's flag turns true,
    which only the first module drag does.
    """

    dependencies = [
        ("worktracker", "0040_story_ideas_intake"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="manual_module_order",
            field=models.BooleanField(default=False),
        ),
    ]
