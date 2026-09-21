//! Additive, project-scoped tags on Work Items.

use std::collections::HashSet;

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, Set, TransactionTrait,
};

use super::{
    identifiers::{database_uuid, new_database_uuid},
    status_facts::{record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity},
    CommandError,
};
use ticketry_entities::{issue, issue_label, label, project};

/// Add tag names to one task and return its complete, canonical tag set.
pub async fn add(
    database: &DatabaseConnection,
    task_id: &str,
    raw_names: Vec<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<Vec<String>, CommandError> {
    let task_id = database_uuid(task_id, "task_id")?;
    let names = normalize(raw_names);
    let transaction = database.begin().await?;

    // Reserve the project's writer before reading labels. This serializes
    // same-project get-or-create and additive association changes.
    let reservation = project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(
            project::Column::Id.in_subquery(
                issue::Entity::find()
                    .select_only()
                    .column(issue::Column::ProjectId)
                    .filter(issue::Column::Id.eq(&task_id))
                    .filter(issue::Column::Type.eq("task"))
                    .into_query(),
            ),
        )
        .exec(&transaction)
        .await?;
    if reservation.rows_affected == 0 {
        return Err(CommandError::NotFound("Work item not found.".to_owned()));
    }
    let task = issue::Entity::find_by_id(&task_id)
        .one(&transaction)
        .await?
        .filter(|row| row.r#type == "task")
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;

    let mut changed = false;
    for name in names {
        let tag = match label::Entity::find()
            .filter(label::Column::ProjectId.eq(&task.project_id))
            .filter(label::Column::Name.eq(&name))
            .one(&transaction)
            .await?
        {
            Some(tag) => tag,
            None => {
                label::ActiveModel {
                    id: Set(new_database_uuid()),
                    project_id: Set(task.project_id.clone()),
                    name: Set(name),
                    color: Set(String::new()),
                }
                .insert(&transaction)
                .await?
            }
        };
        let associated = issue_label::Entity::find()
            .filter(issue_label::Column::IssueId.eq(&task_id))
            .filter(issue_label::Column::LabelId.eq(&tag.id))
            .one(&transaction)
            .await?
            .is_some();
        if !associated {
            issue_label::ActiveModel {
                id: sea_orm::ActiveValue::NotSet,
                issue_id: Set(task_id.clone()),
                label_id: Set(tag.id),
            }
            .insert(&transaction)
            .await?;
            changed = true;
        }
    }

    if changed {
        let revision = super::work_items::next_revision(&transaction, &task.project_id).await?;
        let identity = WorkItemIdentity::of(&task);
        let now = super::timestamp::now();
        let occurred_at = stamp(now);
        let mut active: issue::ActiveModel = task.into();
        active.state_revision = Set(revision);
        active.updated_at = Set(now);
        active.update(&transaction).await?;
        record_work_item(
            facts,
            &transaction,
            identity.fact(WorkItemChange::Updated, revision, &occurred_at),
        )
        .await?;
    }

    let current = current_names(&transaction, &task_id).await?;
    transaction.commit().await?;
    if changed {
        if let Some(facts) = facts {
            facts.wake();
        }
    }
    Ok(current)
}

fn normalize(raw_names: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    raw_names
        .into_iter()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty() && seen.insert(name.clone()))
        .collect()
}

async fn current_names<C: sea_orm::ConnectionTrait>(
    database: &C,
    task_id: &str,
) -> Result<Vec<String>, CommandError> {
    Ok(issue_label::Entity::find()
        .find_also_related(label::Entity)
        .filter(issue_label::Column::IssueId.eq(task_id))
        .order_by_asc(label::Column::Name)
        .all(database)
        .await?
        .into_iter()
        .filter_map(|(_, tag)| tag.map(|tag| tag.name))
        .collect())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

    async fn database() -> DatabaseConnection {
        let database = Database::connect("sqlite::memory:").await.unwrap();
        database
            .execute_unprepared(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE worktracker_project (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    description TEXT NOT NULL,
                    seq_counter INTEGER NOT NULL,
                    state_revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    onboarding_required INTEGER NOT NULL
                );
                CREATE TABLE worktracker_issuetype (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    level TEXT NOT NULL,
                    color TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    start_state_id TEXT,
                    workflow_revision INTEGER NOT NULL,
                    is_pathfind INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE worktracker_issue (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    issue_type_id TEXT NOT NULL,
                    parent_id TEXT,
                    module_id TEXT,
                    state_id TEXT,
                    state_revision INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    sequence_id INTEGER NOT NULL,
                    is_archived INTEGER NOT NULL,
                    rank TEXT NOT NULL,
                    description TEXT NOT NULL,
                    workspace_tab_order TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE worktracker_label (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    color TEXT NOT NULL DEFAULT '',
                    UNIQUE(project_id, name)
                );
                CREATE TABLE worktracker_issue_labels (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    issue_id TEXT NOT NULL,
                    label_id TEXT NOT NULL,
                    UNIQUE(issue_id, label_id)
                );
                INSERT INTO worktracker_project VALUES
                    ('10000000000000000000000000000000', 'One', 'ONE', '', 1, 0,
                     '2026-09-21 00:00:00', '2026-09-21 00:00:00', 0),
                    ('20000000000000000000000000000000', 'Two', 'TWO', '', 1, 0,
                     '2026-09-21 00:00:00', '2026-09-21 00:00:00', 0);
                INSERT INTO worktracker_issuetype VALUES
                    ('11000000000000000000000000000000', '10000000000000000000000000000000',
                     'Story', 'task', '', 0, NULL, 0, 0,
                     '2026-09-21 00:00:00', '2026-09-21 00:00:00'),
                    ('22000000000000000000000000000000', '20000000000000000000000000000000',
                     'Story', 'task', '', 0, NULL, 0, 0,
                     '2026-09-21 00:00:00', '2026-09-21 00:00:00');
                INSERT INTO worktracker_issue VALUES
                    ('11111111111111111111111111111111', '10000000000000000000000000000000',
                     'task', '11000000000000000000000000000000', NULL, NULL, NULL, 0,
                     'First', 1, 0, 'a', '', '[]',
                     '2026-09-21 00:00:00', '2026-09-21 00:00:00'),
                    ('22222222222222222222222222222222', '20000000000000000000000000000000',
                     'task', '22000000000000000000000000000000', NULL, NULL, NULL, 0,
                     'Second', 1, 0, 'a', '', '[]',
                     '2026-09-21 00:00:00', '2026-09-21 00:00:00');
                "#,
            )
            .await
            .unwrap();
        database
    }

    #[tokio::test]
    async fn adds_normalized_names_without_replacing_existing_tags() {
        let database = database().await;

        let first = super::add(
            &database,
            "11111111-1111-1111-1111-111111111111",
            vec![" existing ".into()],
            None,
        )
        .await
        .unwrap();
        assert_eq!(first, vec!["existing"]);

        let current = super::add(
            &database,
            "11111111-1111-1111-1111-111111111111",
            vec![
                " backend ".into(),
                "backend".into(),
                "".into(),
                "Backend".into(),
            ],
            None,
        )
        .await
        .unwrap();

        assert_eq!(current, vec!["Backend", "backend", "existing"]);
    }

    #[tokio::test]
    async fn reuses_only_same_project_labels_and_does_not_advance_an_idempotent_write() {
        let database = database().await;
        database
            .execute_unprepared(
                "INSERT INTO worktracker_label VALUES
                    ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     '10000000000000000000000000000000', 'bug', '#blue'),
                    ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                     '20000000000000000000000000000000', 'bug', '#red');",
            )
            .await
            .unwrap();

        let first = super::add(
            &database,
            "11111111-1111-1111-1111-111111111111",
            vec!["bug".into()],
            None,
        )
        .await
        .unwrap();
        let second = super::add(
            &database,
            "11111111-1111-1111-1111-111111111111",
            vec!["bug".into()],
            None,
        )
        .await
        .unwrap();

        assert_eq!(first, vec!["bug"]);
        assert_eq!(second, vec!["bug"]);
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT i.state_revision, l.project_id, l.color
                 FROM worktracker_issue i
                 JOIN worktracker_issue_labels il ON il.issue_id=i.id
                 JOIN worktracker_label l ON l.id=il.label_id
                 WHERE i.id='11111111111111111111111111111111'"
                    .to_owned(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "state_revision").unwrap(), 1);
        assert_eq!(
            row.try_get::<String>("", "project_id").unwrap(),
            "10000000000000000000000000000000"
        );
        assert_eq!(row.try_get::<String>("", "color").unwrap(), "#blue");
    }
}
