from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("execution", "0002_graphrun")]

    operations = [
        migrations.AlterField(
            model_name="enginerun",
            name="agent",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AlterField(
            model_name="graphrun",
            name="agent",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
    ]
