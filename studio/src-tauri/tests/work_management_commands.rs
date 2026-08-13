use std::collections::HashSet;

use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_commands_and_install;
use muxed_studio_lib::work_management::commands::{
    attachments, blockers, catalog, hierarchy, reorder, state_configuration, work_items, workflow,
};
use muxed_studio_lib::work_management::entities::{
    attachment, issue, issue_type, issue_type_transition, launch_binding, project, state,
};
use muxed_studio_lib::work_management::open_for_commands;
use sea_orm::{
    ColumnTrait, ConnectionTrait, Database, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
};
use tauri_graphql::{TransportApi, TransportApiImpl};

const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const OTHER_TASK_TYPE: &str = "30000000000000000000000000000002";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const DONE: &str = "40000000000000000000000000000002";
const READY: &str = "40000000000000000000000000000003";
const CANCELLED: &str = "40000000000000000000000000000004";

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().expect("create command fixture directory");
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open command fixture writer");
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE worktracker_workspace (
                id char(32) PRIMARY KEY, slug varchar(255) NOT NULL UNIQUE,
                name varchar(255) NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL, onboarding_required bool NOT NULL
            );
            CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY (scope, "key")
            );
            CREATE TABLE worktracker_provider (
                id char(32) PRIMARY KEY, slug varchar(64) NOT NULL UNIQUE,
                activated bool NOT NULL, supports_unattended bool NOT NULL
            );
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
                UNIQUE(project_id, sequence_id),
                FOREIGN KEY(parent_id) REFERENCES worktracker_issue(id) ON DELETE SET NULL
            );
            CREATE TABLE worktracker_issue_blocked_by (
                id integer PRIMARY KEY, from_issue_id char(32) NOT NULL,
                to_issue_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_attachment (
                id char(32) PRIMARY KEY, issue_id char(32) NOT NULL,
                file varchar(100) NOT NULL, filename varchar(512) NOT NULL,
                mime_type varchar(255) NOT NULL, size integer,
                created_at datetime NOT NULL,
                FOREIGN KEY(issue_id) REFERENCES worktracker_issue(id) ON DELETE CASCADE
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
            INSERT INTO worktracker_workspace VALUES
                ('90000000000000000000000000000000', 'meml', 'Memory Lane',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_provider VALUES
                ('50000000000000000000000000000001', 'codex', 1, 1);
            INSERT INTO app_settings VALUES
                ('host', 'provider_catalog',
                 '{{"global_default":{{"provider":"codex","model":null,"reasoning":null}}}}',
                 CURRENT_TIMESTAMP);
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', '90000000000000000000000000000000', 'Memory Lane',
                 'MEM', '', 20, 7, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_state VALUES
                ('{BACKLOG}', '{PROJECT}', 'Backlog', 'backlog', '', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{DONE}', '{PROJECT}', 'Done', 'completed', '', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{TASK_TYPE}', '{PROJECT}', 'Story', 'task', '', 0, '{BACKLOG}', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{OTHER_TASK_TYPE}', '{PROJECT}', 'Task', 'task', '', 1, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{MODULE_TYPE}', '{PROJECT}', 'Epic', 'module', '', 2, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create Django-shaped command fixture");
    drop(writer);
    let database = open_for_commands(&path)
        .await
        .expect("open command database");
    (directory, database)
}

fn create_input(name: impl Into<String>) -> work_items::CreateWorkItem {
    work_items::CreateWorkItem {
        project_id: PROJECT.to_owned(),
        name: name.into(),
        issue_type_id: TASK_TYPE.to_owned(),
        description: None,
        state_id: None,
        parent_id: None,
    }
}

#[tokio::test]
async fn catalogue_creation_validates_groups_levels_and_appends_orders() {
    let (_directory, database) = fixture().await;
    let state_id = catalog::create_state(
        &database,
        catalog::CreateState {
            project_id: PROJECT.to_owned(),
            name: "Ready".to_owned(),
            group: "unstarted".to_owned(),
            color: None,
        },
    )
    .await
    .unwrap();
    let created_state = state::Entity::find_by_id(state_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(created_state.sort_order, 2);
    assert!(!created_state.color.is_empty());
    assert!(!created_state.is_protected);

    let type_id = catalog::create_issue_type(
        &database,
        catalog::CreateIssueType {
            project_id: PROJECT.to_owned(),
            name: "Implementation".to_owned(),
            level: "task".to_owned(),
            color: Some("#123456".to_owned()),
        },
    )
    .await
    .unwrap();
    let created_type = issue_type::Entity::find_by_id(type_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(created_type.sort_order, 2);
    assert_eq!(created_type.color, "#123456");

    let invalid = catalog::create_state(
        &database,
        catalog::CreateState {
            project_id: PROJECT.to_owned(),
            name: "Unknown".to_owned(),
            group: "invented".to_owned(),
            color: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(invalid.code(), "validation");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn concurrent_creates_allocate_one_shared_sequence_and_revision_each() {
    let (_directory, database) = fixture().await;
    let mut creates = Vec::new();
    for index in 0..12 {
        let database = database.clone();
        creates.push(tokio::spawn(async move {
            work_items::create(&database, create_input(format!("Item {index}"))).await
        }));
    }
    let mut ids = Vec::new();
    for create in creates {
        ids.push(create.await.unwrap().unwrap());
    }

    let rows = issue::Entity::find()
        .filter(issue::Column::Id.is_in(ids))
        .all(&database)
        .await
        .unwrap();
    assert_eq!(rows.len(), 12);
    assert_eq!(
        rows.iter()
            .map(|row| row.sequence_id)
            .collect::<HashSet<_>>()
            .len(),
        12
    );
    assert_eq!(rows.iter().map(|row| row.sequence_id).min(), Some(21));
    assert_eq!(rows.iter().map(|row| row.sequence_id).max(), Some(32));
    assert_eq!(rows.iter().map(|row| row.state_revision).min(), Some(8));
    assert_eq!(rows.iter().map(|row| row.state_revision).max(), Some(19));
    let project = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((project.seq_counter, project.state_revision), (32, 19));
}

#[tokio::test]
async fn validation_failure_rolls_back_counters_and_typed_edits_advance_revision() {
    let (_directory, database) = fixture().await;
    let mut invalid = create_input("Wrong birth");
    invalid.state_id = Some(DONE.to_owned());
    let error = work_items::create(&database, invalid).await.unwrap_err();
    assert_eq!(error.code(), "illegal_birth");
    let project = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((project.seq_counter, project.state_revision), (20, 7));

    let id = work_items::create(&database, create_input("  New item  "))
        .await
        .unwrap();
    let created = issue::Entity::find_by_id(&id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(created.name, "New item");
    assert_eq!(created.sequence_id, 21);
    assert_eq!(created.state_id.as_deref(), Some(BACKLOG));
    assert_eq!(created.state_revision, 8);
    assert!(!created.rank.is_empty());

    work_items::update(
        &database,
        work_items::UpdateWorkItem {
            id: id.clone(),
            name: Some("Renamed".to_owned()),
            description: Some("Body".to_owned()),
            issue_type_id: Some(OTHER_TASK_TYPE.to_owned()),
        },
    )
    .await
    .unwrap();
    let updated = issue::Entity::find_by_id(&id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (updated.name.as_str(), updated.description.as_str()),
        ("Renamed", "Body")
    );
    assert_eq!(updated.issue_type_id, OTHER_TASK_TYPE);
    assert_eq!(updated.state_revision, 9);

    let wrong_level = work_items::update(
        &database,
        work_items::UpdateWorkItem {
            id,
            name: None,
            description: None,
            issue_type_id: Some(MODULE_TYPE.to_owned()),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(wrong_level.code(), "validation");
}

#[tokio::test]
async fn hierarchy_create_reparent_detach_repairs_deep_module_ancestry_across_restart() {
    let (directory, database) = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_issue VALUES
                ('20000000000000000000000000000001','{PROJECT}','module','{MODULE_TYPE}',NULL,NULL,NULL,1,'Module A',1,0,'a','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('20000000000000000000000000000002','{PROJECT}','module','{MODULE_TYPE}',NULL,NULL,NULL,2,'Module B',2,0,'b','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('50000000000000000000000000000001','{PROJECT}','task','{TASK_TYPE}','20000000000000000000000000000002','20000000000000000000000000000002','{BACKLOG}',3,'Earlier sibling',3,0,'a','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('50000000000000000000000000000002','{PROJECT}','task','{TASK_TYPE}','20000000000000000000000000000002','20000000000000000000000000000002','{BACKLOG}',4,'Later sibling',4,0,'c','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();

    let mut root_input = create_input("Root");
    root_input.parent_id = Some("20000000-0000-0000-0000-000000000001".to_owned());
    let root = work_items::create(&database, root_input).await.unwrap();
    let mut child_input = create_input("Child");
    child_input.parent_id = Some(root.clone());
    let child = work_items::create(&database, child_input).await.unwrap();
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_issue VALUES ('60000000000000000000000000000001','{PROJECT}','module','{MODULE_TYPE}','{child}','20000000000000000000000000000001',NULL,5,'Nested module',30,0,'m','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
        ))
        .await
        .unwrap();
    let mut nested_child_input = create_input("Nested child");
    nested_child_input.parent_id = Some("60000000-0000-0000-0000-000000000001".to_owned());
    let nested_child = work_items::create(&database, nested_child_input)
        .await
        .unwrap();
    let mut unrelated_input = create_input("Unrelated");
    unrelated_input.parent_id = Some("20000000-0000-0000-0000-000000000001".to_owned());
    let unrelated = work_items::create(&database, unrelated_input)
        .await
        .unwrap();
    let unrelated_before = issue::Entity::find_by_id(&unrelated)
        .one(&database)
        .await
        .unwrap()
        .unwrap();

    hierarchy::reparent(
        &database,
        hierarchy::ReparentWorkItem {
            id: root.clone(),
            parent_id: Some("20000000-0000-0000-0000-000000000002".to_owned()),
            before_id: Some("50000000-0000-0000-0000-000000000001".to_owned()),
            after_id: Some("50000000-0000-0000-0000-000000000002".to_owned()),
        },
    )
    .await
    .unwrap();

    let moved = issue::Entity::find_by_id(&root)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let repaired_child = issue::Entity::find_by_id(&child)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let nested_module = issue::Entity::find_by_id("60000000000000000000000000000001")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let nested_descendant = issue::Entity::find_by_id(&nested_child)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        moved.parent_id.as_deref(),
        Some("20000000000000000000000000000002")
    );
    assert_eq!(
        moved.module_id.as_deref(),
        Some("20000000000000000000000000000002")
    );
    assert!(moved.rank.as_str() > "a" && moved.rank.as_str() < "c");
    assert_eq!(repaired_child.module_id, moved.module_id);
    assert_eq!(nested_module.module_id, moved.module_id);
    assert_eq!(
        nested_descendant.module_id.as_deref(),
        Some("60000000000000000000000000000001")
    );
    assert_eq!(
        issue::Entity::find_by_id(&unrelated)
            .one(&database)
            .await
            .unwrap()
            .unwrap(),
        unrelated_before
    );

    drop(database);
    let database = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    hierarchy::reparent(
        &database,
        hierarchy::ReparentWorkItem {
            id: root.clone(),
            parent_id: None,
            before_id: None,
            after_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        issue::Entity::find_by_id(&root)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .module_id,
        None
    );
    assert_eq!(
        issue::Entity::find_by_id(&child)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .module_id,
        None
    );
    assert_eq!(
        issue::Entity::find_by_id(&nested_child)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .module_id
            .as_deref(),
        Some("60000000000000000000000000000001")
    );
}

#[tokio::test]
async fn invalid_hierarchy_targets_and_foreign_creation_are_atomic() {
    let (_directory, database) = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_project VALUES
                ('11000000000000000000000000000000','90000000000000000000000000000000','Foreign','FOREIGN','',1,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('20000000000000000000000000000001','{PROJECT}','module','{MODULE_TYPE}',NULL,NULL,NULL,1,'Module',1,0,'a','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('21000000000000000000000000000001','11000000000000000000000000000000','module','{MODULE_TYPE}',NULL,NULL,NULL,0,'Foreign module',1,0,'a','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('22000000000000000000000000000001','{PROJECT}','task','{TASK_TYPE}',NULL,'ffffffffffffffffffffffffffffffff','{BACKLOG}',0,'Stale module parent',2,0,'b','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    let mut root_input = create_input("Root");
    root_input.parent_id = Some("20000000000000000000000000000001".to_owned());
    let root = work_items::create(&database, root_input).await.unwrap();
    let mut child_input = create_input("Child");
    child_input.parent_id = Some(root.clone());
    let child = work_items::create(&database, child_input).await.unwrap();
    let before = issue::Entity::find()
        .filter(issue::Column::Id.is_in([root.clone(), child.clone()]))
        .order_by_asc(issue::Column::Id)
        .all(&database)
        .await
        .unwrap();
    let revision_before = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .state_revision;

    for parent_id in [
        root.clone(),
        child.clone(),
        "21000000000000000000000000000001".to_owned(),
        "ffffffffffffffffffffffffffffffff".to_owned(),
    ] {
        assert!(hierarchy::reparent(
            &database,
            hierarchy::ReparentWorkItem {
                id: root.clone(),
                parent_id: Some(parent_id),
                before_id: None,
                after_id: None,
            },
        )
        .await
        .is_err());
    }
    let after = issue::Entity::find()
        .filter(issue::Column::Id.is_in([root, child]))
        .order_by_asc(issue::Column::Id)
        .all(&database)
        .await
        .unwrap();
    assert_eq!(after, before);
    assert_eq!(
        project::Entity::find_by_id(PROJECT)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .state_revision,
        revision_before
    );

    let project_before = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    for parent_id in [
        "21000000000000000000000000000001",
        "22000000000000000000000000000001",
    ] {
        let mut invalid_create = create_input("Rejected");
        invalid_create.parent_id = Some(parent_id.to_owned());
        assert_eq!(
            work_items::create(&database, invalid_create)
                .await
                .unwrap_err()
                .code(),
            "validation"
        );
    }
    assert_eq!(
        project::Entity::find_by_id(PROJECT)
            .one(&database)
            .await
            .unwrap()
            .unwrap(),
        project_before
    );
}

#[tokio::test]
async fn task_reorder_matches_django_boundaries_and_rolls_back_invalid_neighbors() {
    let (_directory, database) = fixture().await;
    let a = work_items::create(&database, create_input("A"))
        .await
        .unwrap();
    let b = work_items::create(&database, create_input("B"))
        .await
        .unwrap();
    let c = work_items::create(&database, create_input("C"))
        .await
        .unwrap();

    reorder::reorder(
        &database,
        reorder::ReorderWorkItem {
            id: c.clone(),
            before_id: None,
            after_id: Some(a.clone()),
            initial_order_ids: None,
        },
    )
    .await
    .unwrap();
    let top = issue::Entity::find_by_id(&c)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let first = issue::Entity::find_by_id(&a)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert!(top.rank < first.rank);

    reorder::reorder(
        &database,
        reorder::ReorderWorkItem {
            id: c.clone(),
            before_id: Some(b.clone()),
            after_id: None,
            initial_order_ids: None,
        },
    )
    .await
    .unwrap();
    let bottom = issue::Entity::find_by_id(&c)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let before = issue::Entity::find_by_id(&b)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert!(bottom.rank > before.rank);

    let ranks_before = issue::Entity::find()
        .filter(issue::Column::Id.is_in([a.clone(), b.clone(), c.clone()]))
        .order_by_asc(issue::Column::Id)
        .all(&database)
        .await
        .unwrap();
    let revision_before = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .state_revision;
    let invalid = reorder::reorder(
        &database,
        reorder::ReorderWorkItem {
            id: a,
            before_id: Some(c),
            after_id: Some(b),
            initial_order_ids: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(invalid.code(), "validation");
    assert_eq!(
        issue::Entity::find()
            .filter(
                issue::Column::Id.is_in(
                    ranks_before
                        .iter()
                        .map(|row| row.id.clone())
                        .collect::<Vec<_>>()
                )
            )
            .order_by_asc(issue::Column::Id)
            .all(&database)
            .await
            .unwrap(),
        ranks_before
    );
    assert_eq!(
        project::Entity::find_by_id(PROJECT)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .state_revision,
        revision_before
    );
}

#[tokio::test]
async fn first_module_drag_is_atomic_and_manual_order_survives_reopen() {
    let (directory, database) = fixture().await;
    let ids = [
        "20000000000000000000000000000001",
        "20000000000000000000000000000002",
        "20000000000000000000000000000003",
    ];
    for (index, (id, name)) in ids.iter().zip(["A", "B", "C"]).enumerate() {
        database
            .execute_unprepared(&format!(
                "INSERT INTO worktracker_issue VALUES ('{id}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL, NULL, 0, '{name}', {}, 0, '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                index + 1
            ))
            .await
            .unwrap();
    }

    let stale = reorder::reorder(
        &database,
        reorder::ReorderWorkItem {
            id: ids[0].to_owned(),
            before_id: None,
            after_id: Some(ids[2].to_owned()),
            initial_order_ids: Some(vec![ids[2].to_owned(), ids[1].to_owned()]),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(stale.code(), "validation");
    let unchanged = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert!(!unchanged.manual_module_order);
    assert!(issue::Entity::find()
        .filter(issue::Column::Type.eq("module"))
        .all(&database)
        .await
        .unwrap()
        .iter()
        .all(|row| row.rank.is_empty()));

    let inverted = reorder::reorder(
        &database,
        reorder::ReorderWorkItem {
            id: ids[0].to_owned(),
            before_id: Some(ids[1].to_owned()),
            after_id: Some(ids[2].to_owned()),
            initial_order_ids: Some(ids.iter().rev().map(|id| (*id).to_owned()).collect()),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(inverted.code(), "validation");
    assert!(
        !project::Entity::find_by_id(PROJECT)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .manual_module_order
    );
    assert!(issue::Entity::find()
        .filter(issue::Column::Type.eq("module"))
        .all(&database)
        .await
        .unwrap()
        .iter()
        .all(|row| row.rank.is_empty()));

    reorder::reorder(
        &database,
        reorder::ReorderWorkItem {
            id: ids[0].to_owned(),
            before_id: None,
            after_id: Some(ids[2].to_owned()),
            initial_order_ids: Some(ids.iter().rev().map(|id| (*id).to_owned()).collect()),
        },
    )
    .await
    .unwrap();
    drop(database);

    let reopened = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    assert!(
        project::Entity::find_by_id(PROJECT)
            .one(&reopened)
            .await
            .unwrap()
            .unwrap()
            .manual_module_order
    );
    let durable_order = issue::Entity::find()
        .filter(issue::Column::Type.eq("module"))
        .order_by_asc(issue::Column::Rank)
        .order_by_asc(issue::Column::Id)
        .all(&reopened)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.name)
        .collect::<Vec<_>>();
    assert_eq!(durable_order, ["A", "C", "B"]);

    let fixed = issue::Entity::find()
        .filter(issue::Column::Type.eq("module"))
        .all(&reopened)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.name, row.rank))
        .collect::<std::collections::HashMap<_, _>>();
    reorder::reorder(
        &reopened,
        reorder::ReorderWorkItem {
            id: ids[0].to_owned(),
            before_id: Some(ids[2].to_owned()),
            after_id: Some(ids[1].to_owned()),
            initial_order_ids: Some(vec![ids[0].to_owned()]),
        },
    )
    .await
    .unwrap();
    let later = issue::Entity::find()
        .filter(issue::Column::Type.eq("module"))
        .all(&reopened)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.name, row.rank))
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(later["B"], fixed["B"]);
    assert_eq!(later["C"], fixed["C"]);
    assert_ne!(later["A"], fixed["A"]);
}

#[tokio::test]
async fn archive_cascades_delete_rejects_children_and_attachment_materializes_first() {
    let (directory, database) = fixture().await;
    let parent = work_items::create(&database, create_input("Parent"))
        .await
        .unwrap();
    let mut child_input = create_input("Child");
    child_input.parent_id = Some(parent.clone());
    let child = work_items::create(&database, child_input).await.unwrap();

    let conflict = work_items::delete(&database, &parent).await.unwrap_err();
    assert_eq!(conflict.code(), "conflict");
    work_items::archive(&database, &parent).await.unwrap();
    assert!(
        issue::Entity::find_by_id(&parent)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .is_archived
    );
    assert!(
        issue::Entity::find_by_id(&child)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .is_archived
    );

    let blocked_root = directory.path().join("not-a-directory");
    std::fs::write(&blocked_root, b"occupied").unwrap();
    let failed = attachments::create(
        &database,
        &attachments::AttachmentStorage::new(blocked_root),
        attachments::CreateAttachment {
            issue_id: child.clone(),
            filename: "lost.txt".to_owned(),
            mime_type: Some("text/plain".to_owned()),
            content: b"never referenced".to_vec(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(failed.code(), "storage_failed");
    assert!(attachments::list(&database, &child)
        .await
        .unwrap()
        .is_empty());

    let storage = attachments::AttachmentStorage::new(directory.path().join("media"));
    let created = attachments::create(
        &database,
        &storage,
        attachments::CreateAttachment {
            issue_id: child.clone(),
            filename: "../note.txt".to_owned(),
            mime_type: Some("text/plain".to_owned()),
            content: b"hello".to_vec(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        (created.filename.as_str(), created.size),
        ("note.txt", Some(5))
    );
    assert_eq!(
        std::fs::read(directory.path().join("media").join(&created.file)).unwrap(),
        b"hello"
    );
    assert_eq!(attachments::list(&database, &child).await.unwrap().len(), 1);

    work_items::delete(&database, &child).await.unwrap();
    assert!(attachment::Entity::find_by_id(created.id)
        .one(&database)
        .await
        .unwrap()
        .is_none());
    work_items::delete(&database, &parent).await.unwrap();
}

#[tokio::test]
async fn graphql_exposes_only_authored_mutations_and_structured_errors() {
    let (directory, database) = fixture().await;
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_state VALUES ('{READY}', '{PROJECT}', 'Ready', 'started', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        .await
        .unwrap();
    let module_ids = [
        "20000000000000000000000000000001",
        "20000000000000000000000000000002",
        "20000000000000000000000000000003",
    ];
    for (index, (id, name)) in module_ids.iter().zip(["A", "B", "C"]).enumerate() {
        database
            .execute_unprepared(&format!(
                "INSERT INTO worktracker_issue VALUES ('{id}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL, NULL, 0, '{name}', {}, 0, '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                index + 1
            ))
            .await
            .unwrap();
    }
    let api = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &directory.path().join("media"),
        &api,
    )
    .await
    .unwrap();

    let schema: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": "{ __schema { mutationType { fields { name } } } }"
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    let fields = schema["data"]["__schema"]["mutationType"]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|field| field["name"].as_str().unwrap())
        .collect::<HashSet<_>>();
    for field in [
        "create_project",
        "create_state",
        "create_issue_type",
        "create_work_item",
        "update_work_item",
        "archive_work_item",
        "reorder_work_item",
        "reparent_work_item",
        "delete_work_item",
        "create_attachment",
        "transition_work_item",
        "set_work_item_blockers",
        "add_work_item_blocker",
        "add_work_item_dependent",
        "remove_state_from_issue_type_workflow",
        "delete_state",
    ] {
        assert!(fields.contains(field), "missing authored mutation {field}");
    }
    assert!(!fields
        .iter()
        .any(|field| field.contains("worktracker_issue")));

    // ST-02: persisted workflow rows are restricted model-shaped CRUD, and the
    // only workflow-scoped operation that is not row CRUD is the declared
    // reachability-pruning exception.
    let mut workflow_mutations = fields
        .iter()
        .copied()
        .filter(|field| {
            field.contains("issue_type_transition")
                || field.contains("launch_binding")
                || field.contains("issue_type_workflow")
        })
        .collect::<Vec<_>>();
    workflow_mutations.sort_unstable();
    assert_eq!(
        workflow_mutations,
        [
            "create_issue_type_transition",
            "delete_issue_type_launch_binding",
            "delete_issue_type_transition",
            "remove_state_from_issue_type_workflow",
            "update_issue_type_transition",
            "upsert_issue_type_launch_binding",
        ]
    );
    assert!(
        !fields
            .iter()
            .any(|field| field.starts_with("set_issue_type")),
        "a per-field workflow mutation is still public: {fields:?}"
    );

    let workflow_write: serde_json::Value = serde_json::from_str(
        &api.clone().graphql_execute(serde_json::json!({
            "query": format!("mutation {{ create_issue_type_transition(issue_type_id: \"{TASK_TYPE}\", from_state_id: \"{BACKLOG}\", to_state_id: \"{READY}\", agent_allowed: true, workflow_revision: 1) {{ agent_allowed }} }}")
        }).to_string()).await,
    ).unwrap();
    assert_eq!(
        workflow_write["data"]["create_issue_type_transition"]["agent_allowed"],
        true
    );
    let stale_workflow_write: serde_json::Value = serde_json::from_str(
        &api.clone().graphql_execute(serde_json::json!({
            "query": format!("mutation {{ update_issue_type_transition(issue_type_id: \"{TASK_TYPE}\", from_state_id: \"{BACKLOG}\", to_state_id: \"{READY}\", agent_allowed: false, workflow_revision: 1) {{ id }} }}")
        }).to_string()).await,
    ).unwrap();
    assert_eq!(
        stale_workflow_write["errors"][0]["extensions"]["code"],
        "stale_revision"
    );
    let binding_write: serde_json::Value = serde_json::from_str(
        &api.clone().graphql_execute(serde_json::json!({
            "query": format!("mutation {{ upsert_issue_type_launch_binding(issue_type_id: \"{TASK_TYPE}\", state_id: \"{BACKLOG}\", workflow_revision: 2, prompt: \"Implement it.\", required_skills: [\"tdd\"]) {{ id prompt required_skills }} }}")
        }).to_string()).await,
    ).unwrap();
    assert!(binding_write.get("errors").is_none(), "{binding_write:#}");
    assert_eq!(
        binding_write["data"]["upsert_issue_type_launch_binding"]["required_skills"],
        serde_json::json!(["tdd"])
    );
    let stale_binding_write: serde_json::Value = serde_json::from_str(
        &api.clone().graphql_execute(serde_json::json!({
            "query": format!("mutation {{ upsert_issue_type_launch_binding(issue_type_id: \"{TASK_TYPE}\", state_id: \"{BACKLOG}\", workflow_revision: 2, prompt: \"Stale\") {{ id }} }}")
        }).to_string()).await,
    ).unwrap();
    assert_eq!(
        stale_binding_write["errors"][0]["extensions"]["code"],
        "stale_revision"
    );
    let unguarded_start_state: serde_json::Value = serde_json::from_str(
        &api.clone().graphql_execute(serde_json::json!({
            "query": format!("mutation {{ update_issue_type(id: \"{TASK_TYPE}\", start_state_id: \"{BACKLOG}\") {{ id }} }}")
        }).to_string()).await,
    ).unwrap();
    assert_eq!(
        unguarded_start_state["errors"][0]["extensions"]["field"],
        "workflow_revision"
    );

    let module_reorder: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": "mutation { reorder_work_item(id: \"20000000-0000-0000-0000-000000000001\", after_id: \"20000000-0000-0000-0000-000000000003\", initial_order_ids: [\"20000000-0000-0000-0000-000000000003\", \"20000000-0000-0000-0000-000000000002\", \"20000000-0000-0000-0000-000000000001\"]) { id rank } }"
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    assert!(module_reorder.get("errors").is_none(), "{module_reorder}");
    assert_eq!(
        module_reorder["data"]["reorder_work_item"]["id"],
        "20000000-0000-0000-0000-000000000001"
    );
    let manual_order: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": "{ modules(project_id: \"10000000-0000-0000-0000-000000000000\") { name } }"
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    assert_eq!(
        manual_order["data"]["modules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|module| module["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["A", "C", "B"]
    );

    let task_a = work_items::create(&database, create_input("GraphQL A"))
        .await
        .unwrap();
    let task_b = work_items::create(&database, create_input("GraphQL B"))
        .await
        .unwrap();
    let transitioned: serde_json::Value = serde_json::from_str(
        &api.clone().graphql_execute(serde_json::json!({
            "query": format!("mutation {{ transition_work_item(id: \"{task_a}\", target_state_id: \"{READY}\", origin: \"agent\") {{ id state state_revision }} }}")
        }).to_string()).await,
    ).unwrap();
    assert!(transitioned.get("errors").is_none(), "{transitioned}");
    assert_eq!(
        transitioned["data"]["transition_work_item"]["state"],
        "40000000-0000-0000-0000-000000000003"
    );
    let task_reorder: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": format!(
                        "mutation {{ reorder_work_item(id: \"{task_b}\", after_id: \"{task_a}\") {{ id rank }} }}"
                    )
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    assert!(task_reorder.get("errors").is_none(), "{task_reorder}");
    assert!(
        task_reorder["data"]["reorder_work_item"]["rank"]
            .as_str()
            .unwrap()
            < issue::Entity::find_by_id(&task_a)
                .one(&database)
                .await
                .unwrap()
                .unwrap()
                .rank
                .as_str()
    );

    let hierarchy_move: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": format!(
                        "mutation {{ reparent_work_item(id: \"{task_b}\", parent_id: \"20000000-0000-0000-0000-000000000002\") {{ id parent_id module_id }} }}"
                    )
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    assert!(hierarchy_move.get("errors").is_none(), "{hierarchy_move}");
    assert_eq!(
        hierarchy_move["data"]["reparent_work_item"]["module_id"],
        "20000000-0000-0000-0000-000000000002"
    );
    let hierarchy_detach: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": format!(
                        "mutation {{ reparent_work_item(id: \"{task_b}\") {{ id parent_id module_id }} }}"
                    )
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    assert!(
        hierarchy_detach.get("errors").is_none(),
        "{hierarchy_detach}"
    );
    assert!(hierarchy_detach["data"]["reparent_work_item"]["parent_id"].is_null());
    assert!(hierarchy_detach["data"]["reparent_work_item"]["module_id"].is_null());

    let created_project: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": "mutation { create_project(name: \"Second\", slug: \"sec\", workspace_slug: \"meml\") { id slug } }"
                })
                .to_string(),
            )
            .await,
    )
    .unwrap();
    assert_eq!(created_project["data"]["create_project"]["slug"], "SEC");
    let new_project_id = created_project["data"]["create_project"]["id"]
        .as_str()
        .unwrap()
        .replace('-', "");
    let command_database = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    assert_eq!(
        state::Entity::find()
            .filter(state::Column::ProjectId.eq(&new_project_id))
            .count(&command_database)
            .await
            .unwrap(),
        8
    );
    assert_eq!(
        issue_type::Entity::find()
            .filter(issue_type::Column::ProjectId.eq(&new_project_id))
            .count(&command_database)
            .await
            .unwrap(),
        4
    );
    let seeded_types = issue_type::Entity::find()
        .filter(issue_type::Column::ProjectId.eq(&new_project_id))
        .all(&command_database)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>();
    assert_eq!(
        launch_binding::Entity::find()
            .filter(launch_binding::Column::IssueTypeId.is_in(seeded_types))
            .count(&command_database)
            .await
            .unwrap(),
        24
    );
    assert!(
        issue_type_transition::Entity::find()
            .count(&command_database)
            .await
            .unwrap()
            > 0
    );

    let response: serde_json::Value = serde_json::from_str(
        &api.graphql_execute(serde_json::json!({
            "query": "mutation { create_work_item(project_id: \"10000000-0000-0000-0000-000000000000\", name: \"Wrong\", issue_type_id: \"30000000-0000-0000-0000-000000000001\", state_id: \"40000000-0000-0000-0000-000000000002\") { id } }"
        }).to_string()).await,
    )
    .unwrap();
    assert_eq!(response["errors"][0]["extensions"]["code"], "illegal_birth");
    assert_eq!(response["errors"][0]["extensions"]["to"], "Done");
}

#[tokio::test]
async fn transitions_preserve_human_agent_reachability_and_cancelled_subtrees() {
    let (_directory, database) = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_state VALUES
                ('{READY}', '{PROJECT}', 'Ready', 'started', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CANCELLED}', '{PROJECT}', 'Cancelled', 'cancelled', '', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetypetransition
                (issue_type_id, from_state_id, to_state_id, agent_allowed) VALUES
                ('{TASK_TYPE}', '{BACKLOG}', '{READY}', 0),
                ('{TASK_TYPE}', '{READY}', '{CANCELLED}', 1),
                ('{TASK_TYPE}', '{CANCELLED}', '{READY}', 1);
            UPDATE worktracker_issuetype SET start_state_id = '{DONE}' WHERE id = '{OTHER_TASK_TYPE}';
            "#
        ))
        .await
        .unwrap();
    let parent = work_items::create(&database, create_input("Parent"))
        .await
        .unwrap();
    let mut child_input = create_input("Child");
    child_input.parent_id = Some(parent.clone());
    let child = work_items::create(&database, child_input).await.unwrap();
    blockers::replace(&database, &parent, vec![child.clone()])
        .await
        .unwrap();

    let denied = workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: parent.clone(),
            target_state_id: READY.to_owned(),
            origin: workflow::TransitionOrigin::Agent,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(denied.code(), "human_only_transition");
    assert_eq!(denied.from_state(), Some("Backlog"));
    assert_eq!(denied.to_state(), Some("Ready"));

    workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: parent.clone(),
            target_state_id: READY.to_owned(),
            origin: workflow::TransitionOrigin::Human,
        },
    )
    .await
    .unwrap();
    workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: parent.clone(),
            target_state_id: CANCELLED.to_owned(),
            origin: workflow::TransitionOrigin::Agent,
        },
    )
    .await
    .unwrap();
    assert!(
        issue::Entity::find_by_id(&parent)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .is_archived
    );
    assert!(
        issue::Entity::find_by_id(&child)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .is_archived
    );

    workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: parent.clone(),
            target_state_id: READY.to_owned(),
            origin: workflow::TransitionOrigin::Human,
        },
    )
    .await
    .unwrap();
    let restored = issue::Entity::find_by_id(&parent)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert!(!restored.is_archived);
    assert!(
        issue::Entity::find_by_id(&child)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .is_archived
    );

    let illegal = workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: parent,
            target_state_id: DONE.to_owned(),
            origin: workflow::TransitionOrigin::Human,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(illegal.code(), "foreign_state");
}

#[tokio::test]
async fn protected_and_referenced_states_cannot_be_deleted() {
    let (_directory, database) = fixture().await;
    database.execute_unprepared(&format!(r#"
        INSERT INTO worktracker_state VALUES
            ('{READY}', '{PROJECT}', 'Ready', 'started', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('{CANCELLED}', '{PROJECT}', 'Custom', 'started', '', 3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    "#)).await.unwrap();
    let protected = state_configuration::delete_state(&database, READY)
        .await
        .unwrap_err();
    assert_eq!(protected.code(), "conflict");
    assert!(protected.to_string().contains("protected"));

    workflow::create_transition(
        &database,
        workflow::NewTransition {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: BACKLOG.to_owned(),
            to_state_id: CANCELLED.to_owned(),
            agent_allowed: true,
            workflow_revision: 1,
        },
    )
    .await
    .unwrap();
    let referenced = state_configuration::delete_state(&database, CANCELLED)
        .await
        .unwrap_err();
    assert_eq!(referenced.code(), "conflict");
    assert!(referenced.to_string().contains("workflow configuration"));
    workflow::delete_transition(
        &database,
        workflow::RevisionedTransition {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: BACKLOG.to_owned(),
            to_state_id: CANCELLED.to_owned(),
            workflow_revision: 2,
        },
    )
    .await
    .unwrap();
    state_configuration::delete_state(&database, CANCELLED)
        .await
        .unwrap();
    assert!(state::Entity::find_by_id(CANCELLED)
        .one(&database)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn workflow_configuration_compare_and_set_is_atomic_and_prunes_unreachable_policy() {
    let (_directory, database) = fixture().await;
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_state VALUES ('{READY}', '{PROJECT}', 'Ready', 'started', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        .await
        .unwrap();

    workflow::create_transition(
        &database,
        workflow::NewTransition {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: BACKLOG.to_owned(),
            to_state_id: READY.to_owned(),
            agent_allowed: true,
            workflow_revision: 1,
        },
    )
    .await
    .unwrap();
    let stale = workflow::create_transition(
        &database,
        workflow::NewTransition {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: READY.to_owned(),
            to_state_id: DONE.to_owned(),
            agent_allowed: true,
            workflow_revision: 1,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(stale.code(), "stale_revision");
    assert_eq!(
        issue_type_transition::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );

    workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: TASK_TYPE.to_owned(),
            state_id: READY.to_owned(),
            workflow_revision: 2,
            prompt: workflow::PatchValue::Value("Implement the work item.".to_owned()),
            required_skills: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Value(true),
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap();
    catalog::update_issue_type(
        &database,
        catalog::UpdateIssueType {
            id: TASK_TYPE.to_owned(),
            name: None,
            color: None,
            sort_order: None,
            start_state_id: Some(READY.to_owned()),
            workflow_revision: Some(3),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        issue_type_transition::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        launch_binding::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        issue_type::Entity::find_by_id(TASK_TYPE)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        4
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_workflow_edits_have_one_winner_and_one_typed_stale_result() {
    let (_directory, database) = fixture().await;
    database.execute_unprepared(&format!(r#"
        INSERT INTO worktracker_state VALUES
            ('{READY}', '{PROJECT}', 'Ready', 'started', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('{CANCELLED}', '{PROJECT}', 'Cancelled', 'cancelled', '', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    "#)).await.unwrap();
    let edits = [(READY, true), (CANCELLED, false)]
        .into_iter()
        .map(|(target, allowed)| {
            let database = database.clone();
            tokio::spawn(async move {
                workflow::create_transition(
                    &database,
                    workflow::NewTransition {
                        issue_type_id: TASK_TYPE.to_owned(),
                        from_state_id: BACKLOG.to_owned(),
                        to_state_id: target.to_owned(),
                        agent_allowed: allowed,
                        workflow_revision: 1,
                    },
                )
                .await
            })
        })
        .collect::<Vec<_>>();
    let mut outcomes = Vec::new();
    for edit in edits {
        outcomes.push(edit.await.unwrap());
    }
    assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        outcomes
            .iter()
            .filter_map(|result| result.as_ref().err())
            .map(|error| error.code())
            .collect::<Vec<_>>(),
        vec!["stale_revision"]
    );
    assert_eq!(
        issue_type_transition::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        issue_type::Entity::find_by_id(TASK_TYPE)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        2
    );
}

#[tokio::test]
async fn blocker_replacement_rejects_bad_graphs_atomically_and_survives_restart() {
    let (directory, database) = fixture().await;
    let a = work_items::create(&database, create_input("A"))
        .await
        .unwrap();
    let b = work_items::create(&database, create_input("B"))
        .await
        .unwrap();
    let c = work_items::create(&database, create_input("C"))
        .await
        .unwrap();
    let foreign = "50000000000000000000000000000009";
    database.execute_unprepared(&format!(r#"
        INSERT INTO worktracker_project VALUES
            ('11000000000000000000000000000000', '90000000000000000000000000000000', 'Other', 'OTH', '', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issue VALUES
            ('{foreign}', '11000000000000000000000000000000', 'task', '{TASK_TYPE}', NULL, NULL, NULL, 0, 'Foreign', 1, 0, 'A', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    "#)).await.unwrap();
    blockers::replace(&database, &a, vec![b.clone()])
        .await
        .unwrap();
    blockers::replace(&database, &b, vec![c.clone()])
        .await
        .unwrap();

    for (candidate, code) in [
        (vec![a.clone()], "blocker_cycle"),
        (vec![c.clone()], "self_blocker"),
        (vec![b.clone(), b.clone()], "duplicate_blocker"),
        (
            vec!["ffffffffffffffffffffffffffffffff".to_owned()],
            "not_found",
        ),
        (vec![foreign.to_owned()], "foreign_scope"),
    ] {
        let error = blockers::replace(&database, &c, candidate)
            .await
            .unwrap_err();
        assert_eq!(error.code(), code);
        assert!(blockers::list(&database, &c).await.unwrap().is_empty());
    }

    drop(database);
    let reopened = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    assert_eq!(
        blockers::list(&reopened, &a).await.unwrap(),
        vec![b.clone()]
    );
    assert_eq!(blockers::list(&reopened, &b).await.unwrap(), vec![c]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn additive_blocker_changes_serialize_without_losing_edges() {
    let (_directory, database) = fixture().await;
    let task = work_items::create(&database, create_input("Blocked"))
        .await
        .unwrap();
    let first = work_items::create(&database, create_input("First blocker"))
        .await
        .unwrap();
    let second = work_items::create(&database, create_input("Second blocker"))
        .await
        .unwrap();

    let additions = [first.clone(), second.clone()].map(|blocker_id| {
        let database = database.clone();
        let task = task.clone();
        tokio::spawn(async move {
            blockers::change(
                &database,
                blockers::BlockerChange::Add {
                    task_id: task,
                    blocker_id,
                },
            )
            .await
        })
    });
    for addition in additions {
        addition.await.unwrap().unwrap();
    }

    let mut committed = blockers::list(&database, &task).await.unwrap();
    committed.sort();
    let mut expected = vec![first.clone(), second];
    expected.sort();
    assert_eq!(committed, expected);

    let revision_before = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .state_revision;
    blockers::change(
        &database,
        blockers::BlockerChange::Add {
            task_id: task,
            blocker_id: first,
        },
    )
    .await
    .unwrap();
    let revision_after = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .state_revision;
    assert_eq!(revision_after, revision_before);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn description_appends_serialize_without_losing_content() {
    let (_directory, database) = fixture().await;
    let mut input = create_input("Append target");
    input.description = Some("Original".to_owned());
    let task = work_items::create(&database, input).await.unwrap();

    let appends = ["First", "Second"].map(|new_content| {
        let database = database.clone();
        let task = task.clone();
        tokio::spawn(async move {
            work_items::append_description(
                &database,
                work_items::AppendDescription {
                    id: task,
                    new_content: new_content.to_owned(),
                },
            )
            .await
        })
    });
    for append in appends {
        append.await.unwrap().unwrap();
    }

    let description = issue::Entity::find_by_id(task)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .description;
    let sections = description.split("\n\n").collect::<HashSet<_>>();
    assert_eq!(sections, HashSet::from(["Original", "First", "Second"]));
}

#[tokio::test]
async fn review_finding_creation_owns_parent_policy_and_evidence_format() {
    let (_directory, database) = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_state VALUES
                ('{READY}', '{PROJECT}', 'Review', 'started', '', 2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('50000000000000000000000000000001', '{PROJECT}', 'Implementation', 'task', '', 2, '{BACKLOG}', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            "#
        ))
        .await
        .unwrap();
    let parent = work_items::create(&database, create_input("Reviewed story"))
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET state_id = '{READY}' WHERE id = '{parent}'"
        ))
        .await
        .unwrap();

    let finding = work_items::create_review_finding(
        &database,
        work_items::CreateReviewFinding {
            project_id: PROJECT.to_owned(),
            parent_id: parent.clone(),
            name: "Controller ownership".to_owned(),
            path: "studio/src-tauri/src/work_management/mcp/dispatch.rs".to_owned(),
            line_start: 10,
            line_end: 12,
            note: Some("Policy belongs in the transaction.".to_owned()),
        },
    )
    .await
    .unwrap();
    let row = issue::Entity::find_by_id(finding)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.parent_id.as_deref(), Some(parent.as_str()));
    assert_eq!(row.issue_type_id, "50000000000000000000000000000001");
    assert_eq!(row.state_id.as_deref(), Some(BACKLOG));
    assert_eq!(
        row.description,
        "Path: studio/src-tauri/src/work_management/mcp/dispatch.rs\nLines: 10-12\nNote: Policy belongs in the transaction."
    );

    let error = work_items::create_review_finding(
        &database,
        work_items::CreateReviewFinding {
            project_id: PROJECT.to_owned(),
            parent_id: parent,
            name: "Bad evidence".to_owned(),
            path: "../outside.rs".to_owned(),
            line_start: 0,
            line_end: 0,
            note: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(error.code(), "malformed_path");
}

#[tokio::test]
async fn launch_binding_patch_preserves_omitted_fields_and_skips_noop_revision() {
    let (_directory, database) = fixture().await;
    let created = workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: TASK_TYPE.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 1,
            prompt: workflow::PatchValue::Value("Initial prompt".to_owned()),
            required_skills: workflow::PatchValue::Value(vec!["tdd".to_owned()]),
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Unset,
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap();
    let revision_after_create = issue_type::Entity::find_by_id(TASK_TYPE)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .workflow_revision;
    assert_eq!(revision_after_create, 2);

    let unchanged = workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: TASK_TYPE.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 2,
            prompt: workflow::PatchValue::Unset,
            required_skills: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Value(false),
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap();
    assert_eq!(unchanged, created);
    let row = launch_binding::Entity::find_by_id(created)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.prompt, "Initial prompt");
    assert_eq!(row.required_skills, serde_json::json!(["tdd"]));
    assert!(!row.auto_start);
    assert_eq!(
        issue_type::Entity::find_by_id(TASK_TYPE)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        revision_after_create
    );
}

#[tokio::test]
async fn automation_flags_ride_the_launch_binding_patch_and_need_a_configured_binding() {
    let (_directory, database) = fixture().await;
    let bare = workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: TASK_TYPE.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 1,
            prompt: workflow::PatchValue::Unset,
            required_skills: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Value(true),
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(bare.code(), "not_found");
    assert_eq!(
        launch_binding::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        issue_type::Entity::find_by_id(TASK_TYPE)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        1
    );

    let id = workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: TASK_TYPE.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 1,
            prompt: workflow::PatchValue::Value("Implement it.".to_owned()),
            required_skills: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Unset,
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap();
    for (revision, auto_start, subtree_run_enabled) in [
        (
            2,
            workflow::PatchValue::Value(true),
            workflow::PatchValue::Unset,
        ),
        (
            3,
            workflow::PatchValue::Unset,
            workflow::PatchValue::Value(true),
        ),
    ] {
        assert_eq!(
            workflow::patch_launch_binding(
                &database,
                workflow::PatchLaunchBinding {
                    issue_type_id: TASK_TYPE.to_owned(),
                    state_id: BACKLOG.to_owned(),
                    workflow_revision: revision,
                    prompt: workflow::PatchValue::Unset,
                    required_skills: workflow::PatchValue::Unset,
                    model_id: workflow::PatchValue::Unset,
                    reasoning_id: workflow::PatchValue::Unset,
                    auto_start,
                    subtree_run_enabled,
                },
            )
            .await
            .unwrap(),
            id
        );
    }
    let row = launch_binding::Entity::find_by_id(id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.prompt, "Implement it.");
    assert!(row.auto_start);
    assert!(row.subtree_run_enabled);
}

#[tokio::test]
async fn transition_rows_reject_stale_revisions_and_unknown_rows() {
    let (_directory, database) = fixture().await;
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_state VALUES ('{READY}', '{PROJECT}', 'Ready', 'started', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        .await
        .unwrap();
    let missing = workflow::update_transition(
        &database,
        workflow::TransitionPatch {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: BACKLOG.to_owned(),
            to_state_id: READY.to_owned(),
            agent_allowed: false,
            workflow_revision: 1,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(missing.code(), "not_found");
    // The refused claim rolled back, so the revision the caller read still holds.
    workflow::create_transition(
        &database,
        workflow::NewTransition {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: BACKLOG.to_owned(),
            to_state_id: READY.to_owned(),
            agent_allowed: true,
            workflow_revision: 1,
        },
    )
    .await
    .unwrap();
    workflow::update_transition(
        &database,
        workflow::TransitionPatch {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: BACKLOG.to_owned(),
            to_state_id: READY.to_owned(),
            agent_allowed: false,
            workflow_revision: 2,
        },
    )
    .await
    .unwrap();
    assert!(
        !issue_type_transition::Entity::find()
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .agent_allowed
    );
    let stale = workflow::delete_transition(
        &database,
        workflow::RevisionedTransition {
            issue_type_id: TASK_TYPE.to_owned(),
            from_state_id: BACKLOG.to_owned(),
            to_state_id: READY.to_owned(),
            workflow_revision: 2,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(stale.code(), "stale_revision");
    assert_eq!(
        issue_type_transition::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );
}
