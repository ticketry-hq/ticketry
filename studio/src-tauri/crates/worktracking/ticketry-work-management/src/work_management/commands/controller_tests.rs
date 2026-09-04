use std::collections::HashSet;

use sea_orm::{ConnectionTrait, Database, EntityTrait};

use super::{blockers, work_items, workflow};
use crate::work_management::open_for_commands;
use ticketry_entities::{issue, issue_type, launch_binding, project};

const PROJECT: &str = "10000000000000000000000000000000";
const STORY: &str = "30000000000000000000000000000001";
const IMPLEMENTATION: &str = "30000000000000000000000000000002";
const BACKLOG: &str = "40000000000000000000000000000001";
const REVIEW: &str = "40000000000000000000000000000002";

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer.execute_unprepared(&format!(r#"
        PRAGMA journal_mode=WAL;
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
            workspace_tab_order json NOT NULL DEFAULT '[]',
            created_at datetime NOT NULL, updated_at datetime NOT NULL,
            UNIQUE(project_id, sequence_id)
        );
        CREATE TABLE worktracker_issue_blocked_by (
            id integer PRIMARY KEY, from_issue_id char(32) NOT NULL,
            to_issue_id char(32) NOT NULL
        );
        CREATE TABLE worktracker_issuetypetransition (
            id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
            from_state_id char(32) NOT NULL, to_state_id char(32) NOT NULL,
            agent_allowed bool NOT NULL, handoff bool NOT NULL DEFAULT 0,
            UNIQUE(issue_type_id, from_state_id, to_state_id)
        );
        CREATE TABLE worktracker_launchbinding (
            id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
            state_id char(32) NOT NULL, prompt text NOT NULL,
            required_skills text NOT NULL, entry_skill varchar(128),
            model_id char(32), reasoning_id char(32),
            auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
            created_at datetime NOT NULL, updated_at datetime NOT NULL,
            UNIQUE(issue_type_id, state_id)
        );
        INSERT INTO worktracker_project VALUES
            ('{PROJECT}', 'Memory Lane', 'MEM', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
        INSERT INTO worktracker_state VALUES
            ('{BACKLOG}', '{PROJECT}', 'Backlog', 'backlog', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('{REVIEW}', '{PROJECT}', 'Review', 'started', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issuetype VALUES
            ('{STORY}', '{PROJECT}', 'Story', 'task', '', 0, '{BACKLOG}', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('{IMPLEMENTATION}', '{PROJECT}', 'Implementation', 'task', '', 1, '{BACKLOG}', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_issuetypetransition
            (issue_type_id, from_state_id, to_state_id, agent_allowed)
            VALUES ('{STORY}', '{BACKLOG}', '{REVIEW}', 1);
    "#)).await.unwrap();
    drop(writer);
    let database = open_for_commands(&path).await.unwrap();
    (directory, database)
}

fn create(name: &str) -> work_items::CreateWorkItem {
    work_items::CreateWorkItem {
        project_id: PROJECT.to_owned(),
        name: name.to_owned(),
        issue_type_id: STORY.to_owned(),
        description: None,
        state_id: None,
        parent_id: None,
    }
}

#[tokio::test]
async fn accepted_transition_arrives_before_an_occupied_destination() {
    let (_directory, database) = fixture().await;
    let existing = work_items::create(&database, create("Existing review item"), None)
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET state_id = '{REVIEW}', rank = 'V' WHERE id = '{existing}'"
        ))
        .await
        .unwrap();
    let moving = work_items::create(&database, create("Moving item"), None)
        .await
        .unwrap();
    let existing_rank = issue::Entity::find_by_id(&existing)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .rank;

    workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: moving.clone(),
            target_state_id: REVIEW.to_owned(),
            origin: workflow::TransitionOrigin::Human,
        },
        None,
    )
    .await
    .unwrap();

    let arrived = issue::Entity::find_by_id(moving)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let unchanged = issue::Entity::find_by_id(existing)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(arrived.state_id.as_deref(), Some(REVIEW));
    assert!(arrived.rank < existing_rank);
    assert_eq!(unchanged.rank, existing_rank);
}

#[tokio::test]
async fn accepted_transition_into_an_empty_destination_replaces_the_old_rank() {
    let (_directory, database) = fixture().await;
    let moving = work_items::create(&database, create("Moving item"), None)
        .await
        .unwrap();
    let old_rank = issue::Entity::find_by_id(&moving)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .rank;

    workflow::transition(
        &database,
        workflow::TransitionWorkItem {
            id: moving.clone(),
            target_state_id: REVIEW.to_owned(),
            origin: workflow::TransitionOrigin::Agent,
        },
        None,
    )
    .await
    .unwrap();

    let arrived = issue::Entity::find_by_id(moving)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(arrived.state_id.as_deref(), Some(REVIEW));
    assert!(!arrived.rank.is_empty());
    assert_ne!(arrived.rank, old_rank);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn blocker_change_serializes_additions_and_makes_repeat_add_a_noop() {
    let (_directory, database) = fixture().await;
    let task = work_items::create(&database, create("Blocked"), None)
        .await
        .unwrap();
    let first = work_items::create(&database, create("First"), None)
        .await
        .unwrap();
    let second = work_items::create(&database, create("Second"), None)
        .await
        .unwrap();
    let additions = [first.clone(), second.clone()].map(|blocker_id| {
        let database = database.clone();
        let task_id = task.clone();
        tokio::spawn(async move {
            blockers::change(
                &database,
                blockers::BlockerChange::Add {
                    task_id,
                    blocker_id,
                },
            )
            .await
        })
    });
    for addition in additions {
        addition.await.unwrap().unwrap();
    }
    assert_eq!(
        blockers::list(&database, &task)
            .await
            .unwrap()
            .into_iter()
            .collect::<HashSet<_>>(),
        HashSet::from([first.clone(), second])
    );
    let before = project::Entity::find_by_id(PROJECT)
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
    let after = project::Entity::find_by_id(PROJECT)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .state_revision;
    assert_eq!(after, before);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn append_description_serializes_read_modify_write() {
    let (_directory, database) = fixture().await;
    let mut input = create("Append target");
    input.description = Some("Original".to_owned());
    let task = work_items::create(&database, input, None).await.unwrap();
    let appends = ["First", "Second"].map(|content| {
        let database = database.clone();
        let id = task.clone();
        tokio::spawn(async move {
            work_items::append_description(
                &database,
                work_items::AppendDescription {
                    id,
                    new_content: content.to_owned(),
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
    assert_eq!(
        description.split("\n\n").collect::<HashSet<_>>(),
        HashSet::from(["Original", "First", "Second"])
    );
}

#[tokio::test]
async fn review_finding_policy_and_evidence_are_owned_by_creation() {
    let (_directory, database) = fixture().await;
    let parent = work_items::create(&database, create("Reviewed story"), None)
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET state_id = '{REVIEW}' WHERE id = '{parent}'"
        ))
        .await
        .unwrap();
    let id = work_items::create_review_finding(
        &database,
        work_items::CreateReviewFinding {
            project_id: PROJECT.to_owned(),
            parent_id: parent.clone(),
            name: "Finding".to_owned(),
            path: "studio/src-tauri/src/work_management/mcp/dispatch.rs".to_owned(),
            line_start: 10,
            line_end: 12,
            note: Some("Controller-owned.".to_owned()),
        },
        None,
    )
    .await
    .unwrap();
    let row = issue::Entity::find_by_id(id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.parent_id.as_deref(), Some(parent.as_str()));
    assert_eq!(row.issue_type_id, IMPLEMENTATION);
    assert_eq!(row.description, "Path: studio/src-tauri/src/work_management/mcp/dispatch.rs\nLines: 10-12\nNote: Controller-owned.");
    let error = work_items::create_review_finding(
        &database,
        work_items::CreateReviewFinding {
            project_id: PROJECT.to_owned(),
            parent_id: parent,
            name: "Invalid".to_owned(),
            path: "../outside.rs".to_owned(),
            line_start: 1,
            line_end: 1,
            note: None,
        },
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code(), "malformed_path");
}

#[tokio::test]
async fn launch_binding_patch_preserves_omissions_and_does_not_revision_a_noop() {
    let (_directory, database) = fixture().await;
    let id = workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: STORY.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 1,
            prompt: workflow::PatchValue::Value("Initial".to_owned()),
            required_skills: workflow::PatchValue::Value(vec!["tdd".to_owned()]),
            entry_skill: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Unset,
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap();
    workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: STORY.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 2,
            prompt: workflow::PatchValue::Unset,
            required_skills: workflow::PatchValue::Unset,
            entry_skill: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Value(false),
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap();
    let row = launch_binding::Entity::find_by_id(id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.prompt, "Initial");
    assert_eq!(row.required_skills, serde_json::json!(["tdd"]));
    assert_eq!(
        issue_type::Entity::find_by_id(STORY)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        2
    );
}

/// A launch that resolves a prompt-less binding fails with
/// `prompt_not_configured` and records nothing, so the whole type/state stops
/// launching silently. The write boundary must refuse to create that row.
#[tokio::test]
async fn a_launch_binding_may_not_be_stored_without_a_prompt() {
    let (_directory, database) = fixture().await;
    let id = workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: STORY.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 1,
            prompt: workflow::PatchValue::Value("Configured".to_owned()),
            required_skills: workflow::PatchValue::Unset,
            entry_skill: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Unset,
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap();

    let error = workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: STORY.to_owned(),
            state_id: BACKLOG.to_owned(),
            workflow_revision: 2,
            prompt: workflow::PatchValue::Value(String::new()),
            required_skills: workflow::PatchValue::Unset,
            entry_skill: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Unset,
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), "prompt_required");
    let row = launch_binding::Entity::find_by_id(id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.prompt, "Configured");
}
