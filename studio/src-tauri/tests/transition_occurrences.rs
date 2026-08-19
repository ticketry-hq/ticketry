use muxed_studio_lib::work_management::{
    commands::workflow::{self, TransitionOrigin, TransitionWorkItem},
    entities::issue,
    open_for_commands,
};
use sea_orm::{ConnectionTrait, Database, DbBackend, EntityTrait, Statement};

const PROJECT: &str = "10000000000000000000000000000000";
const ISSUE_TYPE: &str = "20000000000000000000000000000000";
const ISSUE: &str = "30000000000000000000000000000000";
const FROM: &str = "40000000000000000000000000000000";
const TO: &str = "40000000000000000000000000000001";

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY, workspace_id char(32) NOT NULL,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_state (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, "group" varchar(32) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                is_protected bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, level varchar(16) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                start_state_id char(32), workflow_revision integer NOT NULL,
                is_pathfind bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issue (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type varchar(10) NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(project_id, sequence_id)
            );
            CREATE TABLE worktracker_issuetypetransition (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                from_state_id char(32) NOT NULL, to_state_id char(32) NOT NULL,
                agent_allowed bool NOT NULL,
                UNIQUE(issue_type_id, from_state_id, to_state_id)
            );
            CREATE TABLE worktracker_launchbinding (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                state_id char(32) NOT NULL, prompt text NOT NULL,
                required_skills text NOT NULL, model_id char(32), reasoning_id char(32),
                auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(issue_type_id, state_id)
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', '90000000000000000000000000000000', 'Project', 'PROJ',
                 '', 1, 7, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_state VALUES
                ('{FROM}', '{PROJECT}', 'Implement', 'started', '', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TO}', '{PROJECT}', 'Review', 'started', '', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{ISSUE_TYPE}', '{PROJECT}', 'Implementation', 'task', '', 0,
                 '{FROM}', 11, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{ISSUE}', '{PROJECT}', 'task', '{ISSUE_TYPE}', NULL, NULL, '{FROM}',
                 7, 'Occurrence seam', 1, 0, 'M', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetypetransition
                (issue_type_id, from_state_id, to_state_id, agent_allowed)
                VALUES ('{ISSUE_TYPE}', '{FROM}', '{TO}', 1);
            INSERT INTO worktracker_launchbinding
                (issue_type_id, state_id, prompt, required_skills, model_id, reasoning_id,
                 auto_start, subtree_run_enabled, created_at, updated_at)
                VALUES ('{ISSUE_TYPE}', '{TO}', 'Launch', '[]', NULL, NULL, 1, 0,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    drop(writer);
    let database = open_for_commands(&path).await.unwrap();
    (directory, database)
}

#[tokio::test]
async fn committed_transition_appends_one_durable_frozen_occurrence() {
    let (directory, database) = fixture().await;

    workflow::transition(
        &database,
        TransitionWorkItem {
            id: ISSUE.to_owned(),
            target_state_id: TO.to_owned(),
            origin: TransitionOrigin::Agent,
        },
        None,
    )
    .await
    .unwrap();

    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT version, issue_id, project_id, issue_type_id, from_state_id, \
                    to_state_id, from_group, to_group, work_item_revision, \
                    workflow_revision, destination_auto_start \
             FROM worktracker_transitionoccurrence"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<i64>("", "version").unwrap(), 1);
    assert_eq!(row.try_get::<String>("", "issue_id").unwrap(), ISSUE);
    assert_eq!(row.try_get::<String>("", "project_id").unwrap(), PROJECT);
    assert_eq!(
        row.try_get::<String>("", "issue_type_id").unwrap(),
        ISSUE_TYPE
    );
    assert_eq!(row.try_get::<String>("", "from_state_id").unwrap(), FROM);
    assert_eq!(row.try_get::<String>("", "to_state_id").unwrap(), TO);
    assert_eq!(row.try_get::<String>("", "from_group").unwrap(), "started");
    assert_eq!(row.try_get::<String>("", "to_group").unwrap(), "started");
    assert_eq!(row.try_get::<i64>("", "work_item_revision").unwrap(), 8);
    assert_eq!(row.try_get::<i64>("", "workflow_revision").unwrap(), 11);
    assert!(row.try_get::<bool>("", "destination_auto_start").unwrap());

    drop(database);
    let reopened = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    assert_eq!(
        reopened
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT COUNT(*) AS count FROM worktracker_transitionoccurrence".to_owned(),
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get::<i64>("", "count")
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn rejected_or_rolled_back_transition_publishes_no_occurrence() {
    let (_directory, database) = fixture().await;
    let no_op = workflow::transition(
        &database,
        TransitionWorkItem {
            id: ISSUE.to_owned(),
            target_state_id: FROM.to_owned(),
            origin: TransitionOrigin::Agent,
        },
        None,
    )
    .await;
    assert!(no_op.is_ok());
    let before_failure = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM worktracker_transitionoccurrence".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(before_failure, 0);

    database
        .execute_unprepared(
            "CREATE TRIGGER reject_occurrence BEFORE INSERT ON worktracker_transitionoccurrence \
             BEGIN SELECT RAISE(ABORT, 'producer crash'); END",
        )
        .await
        .unwrap();
    let rolled_back = workflow::transition(
        &database,
        TransitionWorkItem {
            id: ISSUE.to_owned(),
            target_state_id: TO.to_owned(),
            origin: TransitionOrigin::Agent,
        },
        None,
    )
    .await;
    assert!(rolled_back.is_err());

    let issue = issue::Entity::find_by_id(ISSUE)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(issue.state_id.as_deref(), Some(FROM));
    let count = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM worktracker_transitionoccurrence".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(count, 0);
}
