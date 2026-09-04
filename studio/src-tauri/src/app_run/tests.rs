use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use sea_orm::{ConnectionTrait, Database};

use super::{run_id, AppRunError, AppRunLaunch, AppRunObservation, AppRunRuntime, AppRunService};
use crate::settings_persistence::{ModuleLink, Profile, ProfileCatalog, ProfileStore};

const MODULE: &str = "10000000000000000000000000000001";

#[derive(Default)]
struct FakeRuntime {
    observations: Mutex<VecDeque<Option<AppRunObservation>>>,
    launches: Mutex<Vec<AppRunLaunch>>,
    stops: Mutex<Vec<(String, String)>>,
}

#[async_trait]
impl AppRunRuntime for FakeRuntime {
    async fn inspect(&self, _run_id: &str) -> Result<Option<AppRunObservation>, AppRunError> {
        Ok(self.observations.lock().unwrap().pop_front().flatten())
    }
    async fn start(&self, launch: AppRunLaunch) -> Result<(), AppRunError> {
        self.launches.lock().unwrap().push(launch);
        Ok(())
    }
    async fn stop(&self, run_id: &str, namespace: &str) -> Result<(), AppRunError> {
        self.stops
            .lock()
            .unwrap()
            .push((run_id.to_owned(), namespace.to_owned()));
        Ok(())
    }
}

#[test]
fn module_identity_derives_one_stable_app_run_name() {
    assert_eq!(
        run_id("fdeba9a1-5194-42fb-bad3-5cbb1aa4c42c"),
        "app-run-fdeba9a1519442fbbad35cbb1aa4c42c"
    );
    assert!(super::is_app_run_id(
        "app-run-fdeba9a1519442fbbad35cbb1aa4c42c"
    ));
    assert!(!super::is_app_run_id("run-agent"));
}

#[test]
fn launch_material_keeps_command_folder_and_environment_distinct() {
    let launch = AppRunLaunch {
        run_id: "app-run-10000000000000000000000000000001".to_owned(),
        command: "npm run dev".to_owned(),
        working_directory: PathBuf::from("/repo/module"),
        environment: BTreeMap::from([("PORT".to_owned(), "5174".to_owned())]),
        columns: 120,
        rows: 40,
    };
    assert_eq!(launch.command, "npm run dev");
    assert_eq!(launch.working_directory, PathBuf::from("/repo/module"));
    assert_eq!(launch.environment["PORT"], "5174");
}

#[tokio::test]
async fn service_launches_once_with_the_module_folder_command_and_environment() {
    let (directory, database, profiles) = fixture().await;
    let runtime = Arc::new(FakeRuntime::default());
    let service = AppRunService::new(database, profiles, runtime.clone());

    let status = service.start(MODULE, 120, 40).await.unwrap();

    assert!(status.live);
    let launches = runtime.launches.lock().unwrap();
    assert_eq!(launches.len(), 1);
    assert_eq!(launches[0].run_id, run_id(MODULE));
    assert_eq!(launches[0].command, "npm run dev");
    assert_eq!(
        launches[0].working_directory,
        directory.path().join("module")
    );
    assert_eq!(launches[0].environment["PORT"], "5174");
    assert_eq!((launches[0].columns, launches[0].rows), (120, 40));
}

#[tokio::test]
async fn run_while_live_reuses_the_discovered_session_without_launching_or_stopping() {
    let (_directory, database, profiles) = fixture().await;
    let runtime = Arc::new(FakeRuntime::default());
    runtime
        .observations
        .lock()
        .unwrap()
        .push_back(Some(AppRunObservation {
            runtime_namespace: "legacy-runtime".to_owned(),
            live: true,
        }));
    let service = AppRunService::new(database, profiles, runtime.clone());

    let status = service.start(MODULE, 80, 24).await.unwrap();

    assert!(status.live);
    assert!(runtime.launches.lock().unwrap().is_empty());
    assert!(runtime.stops.lock().unwrap().is_empty());
}

#[tokio::test]
async fn explicit_stop_targets_the_discovered_legacy_namespace() {
    let (_directory, database, profiles) = fixture().await;
    let runtime = Arc::new(FakeRuntime::default());
    runtime
        .observations
        .lock()
        .unwrap()
        .push_back(Some(AppRunObservation {
            runtime_namespace: "legacy-runtime".to_owned(),
            live: true,
        }));
    let service = AppRunService::new(database, profiles, runtime.clone());

    let status = service.stop(MODULE).await.unwrap();

    assert!(!status.live);
    assert_eq!(
        runtime.stops.lock().unwrap().as_slice(),
        &[(run_id(MODULE), "legacy-runtime".to_owned())]
    );
}

#[tokio::test]
async fn dropping_studio_services_never_stops_a_live_app_run() {
    let (_directory, database, profiles) = fixture().await;
    let runtime = Arc::new(FakeRuntime::default());
    runtime
        .observations
        .lock()
        .unwrap()
        .push_back(Some(AppRunObservation {
            runtime_namespace: "current-runtime".to_owned(),
            live: true,
        }));
    let service = AppRunService::new(database, profiles, runtime.clone());
    assert!(service.status(MODULE).await.unwrap().live);

    drop(service);

    assert!(runtime.stops.lock().unwrap().is_empty());
}

async fn fixture() -> (tempfile::TempDir, sea_orm::DatabaseConnection, ProfileStore) {
    let directory = tempfile::tempdir().unwrap();
    let module_folder = directory.path().join("module");
    std::fs::create_dir(&module_folder).unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared(&format!(
            r#"
            CREATE TABLE worktracker_issue (
                id char(32) PRIMARY KEY,
                project_id char(32) NOT NULL,
                type varchar(10) NOT NULL,
                issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '20000000000000000000000000000000', 'module',
                 '30000000000000000000000000000000', NULL, NULL, NULL, 0,
                 'Module', 1, 0, 'a', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    drop(writer);
    let database = crate::work_management::open_for_commands(&path)
        .await
        .unwrap();
    crate::work_management::run_configuration::create(
        &database,
        crate::work_management::run_configuration::NewRunConfiguration {
            module_id: MODULE.to_owned(),
            command: "npm run dev".to_owned(),
            environment: BTreeMap::from([("PORT".to_owned(), "5174".to_owned())]),
            preview_url: Some("http://127.0.0.1:5174".to_owned()),
        },
    )
    .await
    .unwrap();
    let profiles = ProfileStore::new(directory.path().join("profiles.json"));
    profiles
        .replace(&ProfileCatalog {
            recent_profile_index: Some(0),
            profiles: vec![Profile {
                name: "Local".to_owned(),
                workspace_slug: "ticketry".to_owned(),
                agent_prompt: None,
                agent_prompts: BTreeMap::new(),
                module_links: vec![ModuleLink {
                    module_id: MODULE.to_owned(),
                    path: module_folder.display().to_string(),
                }],
                recent_project_id: None,
                recent_module_ids: BTreeMap::new(),
            }],
        })
        .unwrap();
    (directory, database, profiles)
}
