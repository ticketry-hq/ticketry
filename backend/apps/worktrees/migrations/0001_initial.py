from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Worktree',
            fields=[
                ('id', models.CharField(primary_key=True, serialize=False)),
                ('task_id', models.CharField(unique=True)),
                ('workspace_slug', models.CharField(null=True)),
                ('project_id', models.CharField(null=True)),
                ('module_id', models.CharField(null=True)),
                ('ticket_seq', models.IntegerField(null=True)),
                ('repo_root', models.CharField()),
                ('path', models.CharField()),
                ('branch', models.CharField()),
                ('base_branch', models.CharField()),
                ('base_commit', models.CharField()),
                ('status', models.CharField()),
                ('ephemeral', models.BooleanField(default=False)),
                ('created_at', models.CharField()),
                ('updated_at', models.CharField()),
            ],
            options={
                'db_table': 'worktrees',
            },
        ),
        migrations.RunSQL(
            sql="""
                DROP TABLE worktrees;
                CREATE TABLE worktrees (
                    id VARCHAR NOT NULL,
                    task_id VARCHAR NOT NULL UNIQUE,
                    workspace_slug VARCHAR,
                    project_id VARCHAR,
                    module_id VARCHAR,
                    ticket_seq INTEGER,
                    repo_root VARCHAR NOT NULL,
                    path VARCHAR NOT NULL,
                    branch VARCHAR NOT NULL,
                    base_branch VARCHAR NOT NULL,
                    base_commit VARCHAR NOT NULL,
                    status VARCHAR NOT NULL,
                    ephemeral BOOL NOT NULL DEFAULT 0,
                    created_at VARCHAR NOT NULL,
                    updated_at VARCHAR NOT NULL,
                    PRIMARY KEY (id)
                );
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
