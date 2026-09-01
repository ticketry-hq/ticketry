//! WorkItem and workflow-state writes publish durable facts to the shared
//! ordered outbox — the same table and cursor sequence the Runs capability
//! already writes, so one subscription carries every status family.

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use ticketry_runs::{outbox_adopted, RunsServices};
use ticketry_work_management::commands::status_facts::WorkFactRecorder;
use ticketry_work_management::commands::{
    catalog, hierarchy, reorder, work_items, workflow,
};
use ticketry_work_management::{
    module_presentation_migration, open_for_commands, workspace_tab_order_migration,
};

const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const DONE: &str = "40000000000000000000000000000002";

struct Fact {
    cursor: i64,
    kind: String,
    subject_kind: String,
    subject_id: String,
    work_item_id: Option<String>,
    payload: serde_json::Value,
    payload_version: i32,
}

async fn facts(database: &DatabaseConnection) -> Vec<Fact> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT cursor, event_kind, subject_kind, subject_id, work_item_id, payload,
                    payload_version
             FROM runs_status_events ORDER BY cursor",
        ))
        .await
        .expect("read the outbox")
        .into_iter()
        .map(|row| Fact {
            cursor: row.try_get("", "cursor").unwrap(),
            kind: row.try_get("", "event_kind").unwrap(),
            subject_kind: row.try_get("", "subject_kind").unwrap(),
            subject_id: row.try_get("", "subject_id").unwrap(),
            work_item_id: row.try_get("", "work_item_id").unwrap(),
            payload: serde_json::from_str(&row.try_get::<String>("", "payload").unwrap()).unwrap(),
            payload_version: row.try_get("", "payload_version").unwrap(),
        })
        .collect()
}

async fn fixture() -> (tempfile::TempDir, DatabaseConnection, WorkFactRecorder) {
    let directory = tempfile::tempdir().expect("create fixture directory");
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open the fixture writer");
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA foreign_keys=ON;
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                onboarding_required bool NOT NULL
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
                UNIQUE(project_id, sequence_id),
                FOREIGN KEY(parent_id) REFERENCES worktracker_issue(id) ON DELETE SET NULL
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
            CREATE TABLE worktracker_transition_occurrences (
                occurrence_id char(32) PRIMARY KEY, issue_id char(32) NOT NULL,
                project_id char(32) NOT NULL, issue_type_id char(32) NOT NULL,
                from_state_id char(32) NOT NULL, to_state_id char(32) NOT NULL,
                from_group varchar(32) NOT NULL, to_group varchar(32) NOT NULL,
                work_item_revision bigint NOT NULL, workflow_revision integer NOT NULL,
                destination_auto_start bool NOT NULL,
                created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE runs_status_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL, event_kind TEXT NOT NULL,
                payload_version INTEGER NOT NULL, subject_kind TEXT NOT NULL,
                subject_id TEXT NOT NULL, agent_run_id TEXT, automation_attempt_id TEXT,
                work_item_id TEXT, payload TEXT NOT NULL,
                committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Memory Lane', 'MEM', '',
                 20, 7, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{BACKLOG}', '{PROJECT}', 'Backlog', 'backlog', '#111111', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{DONE}', '{PROJECT}', 'Done', 'completed', '#222222', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetypetransition
                (issue_type_id, from_state_id, to_state_id, agent_allowed)
                VALUES ('{TASK_TYPE}', '{BACKLOG}', '{DONE}', 1);
            INSERT INTO worktracker_issuetype VALUES
                ('{TASK_TYPE}', '{PROJECT}', 'Story', 'task', '', 0, '{BACKLOG}', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{MODULE_TYPE}', '{PROJECT}', 'Epic', 'module', '', 2, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create the WorkTracker fixture");
    drop(writer);
    let database = open_for_commands(&path).await.expect("open the database");
    workspace_tab_order_migration::install(&database)
        .await
        .expect("install workspace-tab ordering");
    module_presentation_migration::install(&database)
        .await
        .expect("install module presentation");
    let recorder = WorkFactRecorder::new(
        RunsServices::new(database.clone())
            .outbox()
            .events()
            .clone(),
    );
    (directory, database, recorder)
}

fn create_input(name: &str, parent_id: Option<&str>) -> work_items::CreateWorkItem {
    work_items::CreateWorkItem {
        project_id: PROJECT.to_owned(),
        name: name.to_owned(),
        issue_type_id: TASK_TYPE.to_owned(),
        description: None,
        state_id: None,
        parent_id: parent_id.map(str::to_owned),
    }
}

#[tokio::test]
async fn creating_a_work_item_publishes_a_versioned_membership_fact() {
    let (_directory, database, recorder) = fixture().await;

    let id = work_items::create(&database, create_input("First", None), Some(&recorder))
        .await
        .expect("create the work item");

    let published = facts(&database).await;
    assert_eq!(published.len(), 1);
    let fact = &published[0];
    assert_eq!(fact.kind, "work_item.changed");
    assert_eq!(fact.subject_kind, "work_item");
    assert_eq!(fact.subject_id, id);
    assert_eq!(fact.work_item_id.as_deref(), Some(id.as_str()));
    assert_eq!(fact.payload_version, 1);
    assert_eq!(fact.payload["changeKind"], "created");
    assert_eq!(fact.payload["membershipChanged"], true);
    assert_eq!(fact.payload["stateId"], BACKLOG);
    // The revision is the version identity a consumer retains, so it must be
    // the value the write actually allocated rather than a placeholder.
    assert!(fact.payload["revision"].as_i64().expect("a revision") > 7);
    assert!(fact.payload["occurredAt"].as_str().is_some());
}

#[tokio::test]
async fn an_ordinary_field_edit_claims_no_membership_change() {
    let (_directory, database, recorder) = fixture().await;
    let id = work_items::create(&database, create_input("First", None), Some(&recorder))
        .await
        .unwrap();

    work_items::update(
        &database,
        work_items::UpdateWorkItem {
            id: id.clone(),
            name: Some("Renamed".to_owned()),
            description: None,
            issue_type_id: None,
        },
        Some(&recorder),
    )
    .await
    .expect("rename the work item");

    let published = facts(&database).await;
    assert_eq!(published.len(), 2);
    assert_eq!(published[1].payload["changeKind"], "updated");
    assert_eq!(published[1].payload["membershipChanged"], false);
    // The outbox cursor is global and strictly increasing, so a consumer can
    // resume from the last fact it applied.
    assert!(published[1].cursor > published[0].cursor);
}

#[tokio::test]
async fn moving_and_removing_items_publish_explicit_collection_changes() {
    let (_directory, database, recorder) = fixture().await;
    let parent = work_items::create(&database, create_input("Parent", None), Some(&recorder))
        .await
        .unwrap();
    let child = work_items::create(&database, create_input("Child", None), Some(&recorder))
        .await
        .unwrap();

    hierarchy::reparent(
        &database,
        hierarchy::ReparentWorkItem {
            id: child.clone(),
            parent_id: Some(parent.clone()),
            before_id: None,
            after_id: None,
        },
        Some(&recorder),
    )
    .await
    .expect("reparent the child");
    reorder::reorder_work_item(
        &database,
        reorder::ReorderWorkItem {
            id: child.clone(),
            before_id: None,
            after_id: Some(parent.clone()),
            initial_order_ids: None,
        },
        Some(&recorder),
    )
    .await
    .expect("reorder the child");
    work_items::archive(&database, &parent, Some(&recorder))
        .await
        .expect("archive the parent");

    let published = facts(&database).await;
    let kinds: Vec<(&str, &str)> = published
        .iter()
        .map(|fact| {
            (
                fact.kind.as_str(),
                fact.payload["changeKind"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("work_item.changed", "created"),
            ("work_item.changed", "created"),
            ("work_item.changed", "reparented"),
            ("work_item.changed", "reordered"),
            // Archiving cascades, so the child leaves its collections too.
            ("work_item.changed", "archived"),
            ("work_item.changed", "archived"),
        ],
    );
    assert!(published
        .iter()
        .all(|fact| fact.payload["membershipChanged"] == true));
    let archived: Vec<&str> = published[4..]
        .iter()
        .map(|fact| fact.subject_id.as_str())
        .collect();
    assert!(archived.contains(&child.as_str()));
    assert!(archived.contains(&parent.as_str()));
}

#[tokio::test]
async fn deleting_a_work_item_publishes_its_own_removal_family() {
    let (_directory, database, recorder) = fixture().await;
    let id = work_items::create(&database, create_input("Doomed", None), Some(&recorder))
        .await
        .unwrap();

    work_items::delete(&database, &id, Some(&recorder))
        .await
        .expect("delete the work item");

    let published = facts(&database).await;
    assert_eq!(published.last().unwrap().kind, "work_item.deleted");
    assert_eq!(published.last().unwrap().subject_id, id);
    assert_eq!(published.last().unwrap().payload["membershipChanged"], true);
}

#[tokio::test]
async fn workflow_state_writes_publish_the_whole_row() {
    let (_directory, database, recorder) = fixture().await;

    let created = catalog::create_state(
        &database,
        catalog::CreateState {
            project_id: PROJECT.to_owned(),
            name: "In review".to_owned(),
            group: "started".to_owned(),
            color: Some("#abcdef".to_owned()),
        },
        Some(&recorder),
    )
    .await
    .expect("create the state");
    catalog::update_state(
        &database,
        catalog::UpdateState {
            id: created.clone(),
            name: Some("Reviewing".to_owned()),
            group: None,
            color: Some("#123456".to_owned()),
            sort_order: None,
        },
        Some(&recorder),
    )
    .await
    .expect("rename and recolour the state");
    catalog::reorder_states(
        &database,
        PROJECT,
        vec![created.clone(), BACKLOG.to_owned(), DONE.to_owned()],
        Some(&recorder),
    )
    .await
    .expect("reorder the states");

    let published = facts(&database).await;
    assert!(published
        .iter()
        .all(|fact| fact.subject_kind == "workflow_state" && fact.work_item_id.is_none()));
    let renamed = &published[1];
    assert_eq!(renamed.kind, "workflow_state.changed");
    assert_eq!(renamed.payload["changeKind"], "updated");
    // A rename and recolour converge from the fact alone: the published row is
    // the whole state a consumer displays.
    assert_eq!(renamed.payload["state"]["name"], "Reviewing");
    assert_eq!(renamed.payload["state"]["color"], "#123456");
    assert_eq!(renamed.payload["state"]["group"], "started");
    let reordered: Vec<i64> = published[2..]
        .iter()
        .map(|fact| fact.payload["state"]["sort_order"].as_i64().unwrap())
        .collect();
    assert_eq!(reordered, vec![0, 1, 2]);
    assert!(published[2..]
        .iter()
        .all(|fact| fact.payload["changeKind"] == "reordered"));
}

#[tokio::test]
async fn a_rejected_write_publishes_nothing() {
    let (_directory, database, recorder) = fixture().await;
    let id = work_items::create(&database, create_input("Kept", None), Some(&recorder))
        .await
        .unwrap();
    let before = facts(&database).await.len();

    let rejected = work_items::create(&database, create_input("   ", None), Some(&recorder)).await;
    assert!(rejected.is_err());
    let cycle = hierarchy::reparent(
        &database,
        hierarchy::ReparentWorkItem {
            id: id.clone(),
            parent_id: Some(id.clone()),
            before_id: None,
            after_id: None,
        },
        Some(&recorder),
    )
    .await;
    assert!(cycle.is_err());

    assert_eq!(facts(&database).await.len(), before);
}

#[tokio::test]
async fn a_command_without_the_outbox_still_applies_every_invariant() {
    let (_directory, database, _recorder) = fixture().await;

    let id = work_items::create(&database, create_input("Unpublished", None), None)
        .await
        .expect("create without a recorder");
    let rejected = work_items::create(&database, create_input("", None), None).await;

    assert!(rejected.is_err());
    assert!(facts(&database).await.is_empty());
    assert!(!id.is_empty());
}

#[tokio::test]
async fn a_workflow_transition_publishes_the_committed_destination() {
    let (_directory, database, recorder) = fixture().await;
    let id = work_items::create(&database, create_input("Moving", None), Some(&recorder))
        .await
        .unwrap();

    workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: id.clone(),
            target_state_id: DONE.to_owned(),
            origin: workflow::TransitionOrigin::Human,
        },
        Some(&recorder),
    )
    .await
    .expect("take the published edge");

    let published = facts(&database).await;
    let transitioned = published.last().expect("a transition fact");
    assert_eq!(transitioned.payload["changeKind"], "transitioned");
    // The destination is on the fact, so a board converges the moved card
    // without refetching the item first.
    assert_eq!(transitioned.payload["stateId"], DONE);
    assert_eq!(transitioned.payload["membershipChanged"], true);
    assert!(transitioned.payload["revision"].as_i64().unwrap() > 7);
}

#[tokio::test]
async fn composition_publishes_only_where_the_outbox_is_adopted() {
    let (_directory, adopted, _recorder) = fixture().await;
    assert!(outbox_adopted(&adopted).await);

    // A pre-adoption database composes no recorder, so an authored write can
    // never depend on a durable table that does not exist yet.
    let directory = tempfile::tempdir().expect("create a pre-adoption directory");
    let path = directory.path().join("state.db");
    let pending = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open a pre-adoption database");
    pending
        .execute_unprepared("CREATE TABLE placeholder (id TEXT PRIMARY KEY);")
        .await
        .expect("create the placeholder table");

    assert!(!outbox_adopted(&pending).await);
}
