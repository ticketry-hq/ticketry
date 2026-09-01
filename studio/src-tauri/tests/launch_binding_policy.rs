use sea_orm::{ConnectionTrait, Database, EntityTrait, PaginatorTrait};
use ticketry_entities::{issue_type, launch_binding};
use ticketry_work_management::{
    commands::workflow, open_for_commands, read_queries,
};

const PROJECT: &str = "10000000000000000000000000000000";
const FOREIGN_PROJECT: &str = "10000000000000000000000000000001";
const STORY: &str = "30000000000000000000000000000001";
const BUILD: &str = "40000000000000000000000000000001";
const REVIEW: &str = "40000000000000000000000000000002";
const FOREIGN_STATE: &str = "40000000000000000000000000000003";
const CODEX: &str = "50000000000000000000000000000001";
const DISABLED: &str = "50000000000000000000000000000002";
const INTERACTIVE: &str = "50000000000000000000000000000003";
const GPT: &str = "60000000000000000000000000000001";
const DISABLED_MODEL: &str = "60000000000000000000000000000002";
const INTERACTIVE_MODEL: &str = "60000000000000000000000000000003";
const HIGH: &str = "70000000000000000000000000000001";
const LOW: &str = "70000000000000000000000000000002";

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY (scope, "key")
            );
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
            CREATE TABLE worktracker_provider (
                id char(32) PRIMARY KEY, slug varchar(64) NOT NULL UNIQUE,
                activated bool NOT NULL, supports_unattended bool NOT NULL
            );
            CREATE TABLE worktracker_agentmodel (
                id char(32) PRIMARY KEY, provider_id char(32) NOT NULL,
                name varchar(255) NOT NULL
            );
            CREATE TABLE worktracker_reasoninglevel (
                id char(32) PRIMARY KEY, name varchar(32) NOT NULL
            );
            CREATE TABLE worktracker_agentmodelreasoninglevel (
                id integer PRIMARY KEY AUTOINCREMENT,
                agent_model_id char(32) NOT NULL, reasoning_level_id char(32) NOT NULL,
                UNIQUE(agent_model_id, reasoning_level_id)
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
                ('{PROJECT}', 'Main', 'MAIN', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0),
                ('{FOREIGN_PROJECT}', 'Foreign', 'FOR', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{BUILD}', '{PROJECT}', 'Build', 'started', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{REVIEW}', '{PROJECT}', 'Review', 'started', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{FOREIGN_STATE}', '{FOREIGN_PROJECT}', 'Foreign', 'started', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{STORY}', '{PROJECT}', 'Story', 'task', '', 0, '{BUILD}', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_provider VALUES
                ('{CODEX}', 'codex', 1, 1),
                ('{DISABLED}', 'disabled', 0, 1),
                ('{INTERACTIVE}', 'interactive', 1, 0);
            INSERT INTO worktracker_agentmodel VALUES
                ('{GPT}', '{CODEX}', 'gpt-5.6'),
                ('{DISABLED_MODEL}', '{DISABLED}', 'disabled-model'),
                ('{INTERACTIVE_MODEL}', '{INTERACTIVE}', 'interactive-model');
            INSERT INTO worktracker_reasoninglevel VALUES
                ('{HIGH}', 'high'), ('{LOW}', 'low');
            INSERT INTO worktracker_agentmodelreasoninglevel
                (agent_model_id, reasoning_level_id) VALUES ('{GPT}', '{HIGH}');
            INSERT INTO app_settings VALUES
                ('host', 'provider_catalog',
                 '{{"global_default":{{"provider":"codex","model":"gpt-5.6","reasoning":"high"}}}}',
                 CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    drop(writer);
    let database = open_for_commands(&path).await.unwrap();
    (directory, database)
}

fn patch(state_id: &str) -> workflow::PatchLaunchBinding {
    workflow::PatchLaunchBinding {
        issue_type_id: STORY.to_owned(),
        state_id: state_id.to_owned(),
        workflow_revision: 1,
        prompt: workflow::PatchValue::Value("Implement it.".to_owned()),
        required_skills: workflow::PatchValue::Value(vec!["tdd".to_owned()]),
        model_id: workflow::PatchValue::Value(GPT.to_owned()),
        reasoning_id: workflow::PatchValue::Value(HIGH.to_owned()),
        auto_start: workflow::PatchValue::Value(true),
        subtree_run_enabled: workflow::PatchValue::Value(true),
    }
}

async fn assert_no_effect(database: &sea_orm::DatabaseConnection) {
    assert_eq!(
        launch_binding::Entity::find()
            .count(database)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        issue_type::Entity::find_by_id(STORY)
            .one(database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        1
    );
}

#[tokio::test]
async fn binding_create_normalizes_and_round_trips_the_complete_policy() {
    let (_directory, database) = fixture().await;
    let id = workflow::patch_launch_binding(&database, patch(BUILD))
        .await
        .unwrap();
    let rows = read_queries::launch_bindings(&database, PROJECT)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, id);
    assert_eq!(rows[0].required_skills.0, ["tdd"]);
    assert_eq!(
        rows[0].model.as_deref(),
        Some("60000000-0000-0000-0000-000000000001")
    );
    assert_eq!(
        rows[0].reasoning.as_deref(),
        Some("70000000-0000-0000-0000-000000000001")
    );
    assert!(rows[0].auto_start && rows[0].subtree_run_enabled);
    assert_eq!(
        issue_type::Entity::find_by_id(STORY)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        2
    );

    let mut update = patch(BUILD);
    update.workflow_revision = 2;
    update.prompt = workflow::PatchValue::Value("Implement the revised policy.".to_owned());
    assert_eq!(
        workflow::patch_launch_binding(&database, update)
            .await
            .unwrap(),
        id
    );
    assert_eq!(
        launch_binding::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        launch_binding::Entity::find_by_id(id)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .prompt,
        "Implement the revised policy."
    );
    assert_eq!(
        issue_type::Entity::find_by_id(STORY)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        3
    );
}

#[tokio::test]
async fn invalid_candidates_reject_without_a_row_or_revision_change() {
    for invalid in 0..9 {
        let (_directory, database) = fixture().await;
        let mut candidate = patch(BUILD);
        match invalid {
            0 => candidate.state_id = FOREIGN_STATE.to_owned(),
            1 => {
                candidate.model_id =
                    workflow::PatchValue::Value("ffffffffffffffffffffffffffffffff".to_owned())
            }
            2 => candidate.model_id = workflow::PatchValue::Value(DISABLED_MODEL.to_owned()),
            3 => candidate.reasoning_id = workflow::PatchValue::Value(LOW.to_owned()),
            4 => candidate.model_id = workflow::PatchValue::Null,
            5 => candidate.required_skills = workflow::PatchValue::Value(vec!["future".to_owned()]),
            6 => {
                candidate.required_skills =
                    workflow::PatchValue::Value(vec!["tdd".to_owned(), "tdd".to_owned()])
            }
            7 => candidate.prompt = workflow::PatchValue::Value(String::new()),
            8 => candidate.model_id = workflow::PatchValue::Value(INTERACTIVE_MODEL.to_owned()),
            _ => unreachable!(),
        }
        workflow::patch_launch_binding(&database, candidate)
            .await
            .expect_err("invalid launch policy must be rejected");
        assert_no_effect(&database).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_updates_have_one_revision_winner() {
    let (_directory, database) = fixture().await;
    let writes = [BUILD, REVIEW].map(|state_id| {
        let database = database.clone();
        tokio::spawn(
            async move { workflow::patch_launch_binding(&database, patch(state_id)).await },
        )
    });
    let [first, second] = writes;
    let (first, second) = tokio::join!(first, second);
    let results = vec![first.unwrap(), second.unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .next()
            .unwrap()
            .code(),
        "stale_revision"
    );
    assert_eq!(
        launch_binding::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn clear_survives_restart_and_atomically_advances_revision() {
    let (directory, database) = fixture().await;
    workflow::patch_launch_binding(&database, patch(BUILD))
        .await
        .unwrap();
    database.close().await.unwrap();
    let reopened = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    assert_eq!(
        launch_binding::Entity::find()
            .count(&reopened)
            .await
            .unwrap(),
        1
    );
    workflow::delete_launch_binding(
        &reopened,
        workflow::RevisionedState {
            issue_type_id: STORY.to_owned(),
            state_id: BUILD.to_owned(),
            workflow_revision: 2,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        launch_binding::Entity::find()
            .count(&reopened)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        issue_type::Entity::find_by_id(STORY)
            .one(&reopened)
            .await
            .unwrap()
            .unwrap()
            .workflow_revision,
        3
    );
}
