//! Full task prompt composition from durable Work Item facts and resolved
//! launch-policy input.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

use crate::planning::{build_task_prompt, TaskPromptInput};

use ticketry_entities::{state, transition_occurrence};

use super::{error::LaunchAuthorityError, facts};

pub struct TaskPromptSource<'a> {
    pub task_id: &'a str,
    pub module_id: &'a str,
    pub local_module_folder: &'a str,
    pub state_name: Option<&'a str>,
    pub workflow_prompt: &'a str,
    pub stage_skills: &'a [String],
    pub additional_user_input: Option<&'a str>,
    pub design_directory: Option<&'a str>,
    /// The same directory resolved absolutely, when the caller has it.
    pub design_directory_root: Option<&'a str>,
}

pub async fn compose_task_prompt(
    database: &DatabaseConnection,
    source: TaskPromptSource<'_>,
) -> Result<String, LaunchAuthorityError> {
    let task = facts::work_item(database, source.task_id).await?;
    let prompt_facts = facts::task_prompt_facts(
        database,
        &task,
        source.module_id,
        source.local_module_folder.to_owned(),
        source.state_name.map(str::to_owned),
    )
    .await?;
    let previous_state_name = previous_state_name(database, &task).await?;
    Ok(build_task_prompt(&TaskPromptInput {
        facts: prompt_facts,
        workflow_prompt: source.workflow_prompt.to_owned(),
        stage_skills: source.stage_skills.to_owned(),
        additional_user_input: source.additional_user_input.map(str::to_owned),
        design_directory: source.design_directory.map(str::to_owned),
        design_directory_root: source.design_directory_root.map(str::to_owned),
        previous_state_name,
    }))
}

/// The workflow state this work item just left, if it left one.
///
/// The latest committed transition occurrence into the work item's current
/// state is the answer for every replacement launch: Run Now, auto-start,
/// and retry all compose their prompt after the move has committed, so the
/// occurrence's source state is the one the work item just left. Launches
/// that did not move the work item have no previous state and no note.
async fn previous_state_name(
    database: &DatabaseConnection,
    task: &ticketry_entities::issue::Model,
) -> Result<Option<String>, LaunchAuthorityError> {
    let Some(current_state_id) = task.state_id.as_deref() else {
        return Ok(None);
    };
    let from_state_id = transition_occurrence::Entity::find()
        .filter(transition_occurrence::Column::IssueId.eq(&task.id))
        .filter(transition_occurrence::Column::ToStateId.eq(current_state_id))
        // SQLite stores committed_at at second precision, so two occurrences
        // into the same state inside one second tie; the work-item revision
        // is the monotonic tie-break on the row.
        .order_by_desc(transition_occurrence::Column::CommittedAt)
        .order_by_desc(transition_occurrence::Column::WorkItemRevision)
        .limit(1)
        .one(database)
        .await?
        .map(|occurrence| occurrence.from_state_id);
    let Some(from_state_id) = from_state_id else {
        return Ok(None);
    };
    Ok(state::Entity::find_by_id(from_state_id)
        .one(database)
        .await?
        .map(|row| row.name))
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        entity::prelude::DateTime as NaiveDateTime, ConnectionTrait, Database, DatabaseConnection,
        EntityTrait, Set,
    };

    use ticketry_entities::{issue, transition_occurrence};

    use super::previous_state_name;

    const ISSUE_TABLE: &str = "CREATE TABLE worktracker_issue (
            id varchar NOT NULL PRIMARY KEY,
            project_id varchar NOT NULL,
            type varchar NOT NULL,
            issue_type_id varchar NOT NULL,
            parent_id varchar,
            module_id varchar,
            state_id varchar,
            state_revision bigint NOT NULL,
            name varchar NOT NULL,
            sequence_id integer NOT NULL,
            is_archived boolean NOT NULL,
            rank varchar NOT NULL,
            description text NOT NULL,
            workspace_tab_order json NOT NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL
        )";

    const STATE_TABLE: &str = "CREATE TABLE worktracker_state (
            id varchar NOT NULL PRIMARY KEY,
            project_id varchar NOT NULL,
            name varchar NOT NULL,
            \"group\" varchar NOT NULL,
            color varchar NOT NULL,
            sort_order integer NOT NULL,
            is_protected boolean NOT NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL
        )";

    async fn database() -> DatabaseConnection {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.db");
        Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .unwrap()
            .close()
            .await
            .unwrap();
        let database = ticketry_work_management::open_for_commands(&path)
            .await
            .unwrap();
        database.execute_unprepared(ISSUE_TABLE).await.unwrap();
        database.execute_unprepared(STATE_TABLE).await.unwrap();
        database
            .execute_unprepared(
                "INSERT INTO worktracker_issue VALUES (
                    'task', 'project', 'task', 'story', NULL, NULL,
                    'state-implement', 9, 'Tie-break', 1844, 0, 'rank', '', '[]',
                    '2026-09-01 10:00:00', '2026-09-01 10:00:00'
                );
                INSERT INTO worktracker_state VALUES
                    ('state-todo', 'project', 'Todo', 'started', '', 1, 0,
                     '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
                    ('state-review', 'project', 'Review', 'started', '', 2, 0,
                     '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
                    ('state-implement', 'project', 'Implement', 'started', '', 3, 0,
                     '2026-09-01 09:00:00', '2026-09-01 09:00:00');",
            )
            .await
            .unwrap();
        database
    }

    fn occurrence(from_state: &str, revision: i64) -> transition_occurrence::ActiveModel {
        transition_occurrence::ActiveModel {
            occurrence_id: Set(format!("occ-{from_state}-{revision}")),
            version: Set(1),
            issue_id: Set("task".to_owned()),
            project_id: Set("project".to_owned()),
            issue_type_id: Set("story".to_owned()),
            from_state_id: Set(from_state.to_owned()),
            to_state_id: Set("state-implement".to_owned()),
            from_group: Set("started".to_owned()),
            to_group: Set("started".to_owned()),
            work_item_revision: Set(revision),
            workflow_revision: Set(1),
            destination_auto_start: Set(false),
            handoff: Set(true),
            origin: Set("agent".to_owned()),
            run_now_decision_id: Set(None),
            committed_at: Set(NaiveDateTime::parse_from_str(
                "2026-09-01 10:00:00",
                "%Y-%m-%d %H:%M:%S",
            )
            .unwrap()),
        }
    }

    /// SQLite stores committed_at at second precision, so two occurrences
    /// into the same state inside one second tie on the primary sort key.
    /// The work-item revision is the monotonic tie-break on the row: the
    /// last move must name the state it came from, whatever the insertion
    /// order of the tied rows is.
    #[tokio::test]
    async fn the_latest_revision_breaks_a_committed_at_tie() {
        let database = database().await;
        transition_occurrence::Entity::insert(occurrence("state-review", 9))
            .exec(&database)
            .await
            .unwrap();
        transition_occurrence::Entity::insert(occurrence("state-todo", 2))
            .exec(&database)
            .await
            .unwrap();

        let task = issue::Entity::find_by_id("task")
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        let previous = previous_state_name(&database, &task).await.unwrap();

        assert_eq!(previous.as_deref(), Some("Review"));
    }
}
