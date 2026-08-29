use std::collections::BTreeSet;
use std::fs;
use std::sync::Arc;

use muxed_studio_lib::settings_persistence::{
    adopt, AppSetting, AppSettingRepository, JsonSourceClassification, ModuleLink, SettingKey,
    SettingScope, Slice2Readiness, SourceClassification,
};
use sea_orm::{ConnectionTrait, Database};

async fn fixture() -> tempfile::TempDir {
    let directory = tempfile::tempdir().expect("create settings fixture");
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open settings fixture");
    database
        .execute_unprepared(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE django_migrations (
                id integer PRIMARY KEY AUTOINCREMENT,
                app varchar(255) NOT NULL,
                name varchar(255) NOT NULL,
                applied datetime NOT NULL
            );
            INSERT INTO django_migrations (app, name, applied) VALUES
                ('settings_store', '0001_initial', CURRENT_TIMESTAMP),
                ('settings_store', '0002_migrate_profile_prompt_authority', CURRENT_TIMESTAMP);
            CREATE TABLE app_settings (
                scope varchar NOT NULL,
                "key" varchar NOT NULL,
                value varchar NOT NULL,
                updated_at varchar NOT NULL,
                PRIMARY KEY (scope, "key")
            );
            INSERT INTO app_settings VALUES
                ('host', 'keybindings', '[{"actionId":"settings"}]',
                 '2026-07-23T00:00:00+00:00');
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
                agent_model_id char(32) NOT NULL,
                reasoning_level_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_state (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_launchbinding (
                id integer PRIMARY KEY AUTOINCREMENT,
                issue_type_id char(32) NOT NULL,
                state_id char(32) NOT NULL,
                prompt text NOT NULL,
                required_skills text NOT NULL,
                model_id char(32),
                reasoning_id char(32),
                auto_start bool NOT NULL,
                subtree_run_enabled bool NOT NULL,
                created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            INSERT INTO worktracker_provider VALUES
                ('10000000000000000000000000000001', 'agy', 0, 1),
                ('10000000000000000000000000000002', 'claude', 1, 1),
                ('10000000000000000000000000000003', 'codex', 1, 1),
                ('10000000000000000000000000000004', 'gemini', 1, 1);
            "#,
        )
        .await
        .expect("create settings schema");
    database.close().await.expect("close settings fixture");
    directory
}

#[tokio::test]
async fn adoption_preserves_rows_files_and_reopens_idempotently() {
    let directory = fixture().await;
    let profiles = br#"{
        "recent_profile_index": 0,
        "profiles": [{
            "name": "Existing",
            "workspace_slug": "meml",
            "module_links": [{"module_id": "module-1", "path": "/src/one"}]
        }]
    }"#;
    let features = br#"{"sidebar":true,"projects":true,"future":true}"#;
    fs::write(directory.path().join("profiles.json"), profiles).expect("seed profiles");
    fs::write(directory.path().join("features.json"), features).expect("seed features");

    let first = adopt(directory.path()).await.expect("adopt settings");
    assert_eq!(first.source, SourceClassification::DjangoCurrent);
    assert_eq!(first.profiles_source, JsonSourceClassification::Valid);
    assert_eq!(first.features_source, JsonSourceClassification::Valid);
    assert_eq!(
        fs::read(first.profiles_snapshot.as_ref().expect("profile snapshot"))
            .expect("read profile snapshot"),
        profiles
    );
    assert_eq!(
        fs::read(first.features_snapshot.as_ref().expect("feature snapshot"))
            .expect("read feature snapshot"),
        features
    );
    assert_eq!(
        fs::read(directory.path().join("profiles.json")).unwrap(),
        profiles
    );
    assert_eq!(
        fs::read(directory.path().join("features.json")).unwrap(),
        features
    );

    let repository = AppSettingRepository::open(&directory.path().join("state.db"))
        .await
        .expect("reopen repository");
    let row = repository
        .get(
            &SettingScope::new("host").unwrap(),
            &SettingKey::new("keybindings").unwrap(),
        )
        .await
        .unwrap()
        .expect("existing setting");
    assert_eq!(row.value, r#"[{"actionId":"settings"}]"#);
    assert_eq!(row.updated_at, "2026-07-23T00:00:00+00:00");

    let second = adopt(directory.path()).await.expect("reopen adoption");
    assert_eq!(second.source, SourceClassification::RustOwned);
    assert_eq!(second.settings_digest, first.settings_digest);
    assert!(second.database_snapshot.is_none());
}

#[tokio::test]
async fn unknown_generation_fails_before_any_mutation() {
    let directory = fixture().await;
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap();
    database
        .execute_unprepared(
            "INSERT INTO django_migrations (app, name, applied) VALUES ('settings_store', '9999_unknown', CURRENT_TIMESTAMP)",
        )
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path())
        .await
        .expect_err("reject unknown generation");

    assert_eq!(error.code(), "unknown_settings_schema");
    assert!(!directory.path().join("settings-cutover.json").exists());
    assert!(!directory
        .path()
        .join("state.db.pre-rust-settings.1")
        .exists());
    let database = Database::connect(format!("sqlite:{}?mode=ro", path.display()))
        .await
        .unwrap();
    let ledger: i64 = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE name='ticketry_settings_adoption'"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "count")
        .unwrap();
    assert_eq!(ledger, 0);
}

#[tokio::test]
async fn provider_catalog_drift_fails_before_any_mutation() {
    let directory = fixture().await;
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap();
    database
        .execute_unprepared("DELETE FROM worktracker_provider WHERE slug = 'agy'")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path())
        .await
        .expect_err("adapter/catalog drift must stop the handoff");

    assert_eq!(error.code(), "unknown_settings_schema");
    assert!(!directory.path().join("settings-cutover.json").exists());
    assert!(!directory
        .path()
        .join("state.db.pre-rust-settings.1")
        .exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn scoped_settings_round_trip_restart_and_concurrent_updates() {
    let directory = fixture().await;
    let path = directory.path().join("state.db");
    let repository = Arc::new(AppSettingRepository::open(&path).await.unwrap());
    let mut writes = Vec::new();
    for index in 0..12 {
        let repository = repository.clone();
        writes.push(tokio::spawn(async move {
            repository
                .put(&AppSetting {
                    scope: SettingScope::new("profile:0").unwrap(),
                    key: SettingKey::new(format!("setting-{index}")).unwrap(),
                    value: format!("value-{index}"),
                    updated_at: format!("2026-08-12T00:00:{index:02}+00:00"),
                })
                .await
        }));
    }
    for write in writes {
        write.await.unwrap().unwrap();
    }
    drop(repository);

    let restarted = AppSettingRepository::open(&path).await.unwrap();
    let mut values = BTreeSet::new();
    for index in 0..12 {
        let row = restarted
            .get(
                &SettingScope::new("profile:0").unwrap(),
                &SettingKey::new(format!("setting-{index}")).unwrap(),
            )
            .await
            .unwrap()
            .unwrap();
        values.insert((row.value, row.updated_at));
    }
    assert_eq!(values.len(), 12);
}

#[tokio::test]
async fn adoption_refuses_malformed_json_before_snapshot_or_ledger() {
    let directory = fixture().await;
    let profiles_path = directory.path().join("profiles.json");
    let features_path = directory.path().join("features.json");
    fs::write(&profiles_path, b"{broken").unwrap();
    fs::write(&features_path, b"not-json").unwrap();

    let error = adopt(directory.path())
        .await
        .expect_err("corrupt transferred assets must stop adoption");

    assert_eq!(error.code(), "configuration_corrupt");
    assert_eq!(fs::read(profiles_path).unwrap(), b"{broken");
    assert_eq!(fs::read(features_path).unwrap(), b"not-json");
    assert!(!directory.path().join("settings-cutover.json").exists());
    assert!(!directory
        .path()
        .join("profiles.json.pre-rust-settings.1")
        .exists());
    assert!(!directory
        .path()
        .join("features.json.pre-rust-settings.1")
        .exists());
}

#[tokio::test]
async fn settings_storage_has_no_generated_crud_surface() {
    let sdl = muxed_studio_lib::graphql_foundation::generated_schema_sdl()
        .await
        .unwrap();
    assert!(!sdl.contains("appSetting"));
    assert!(!sdl.contains("AppSetting"));
}

/// `profiles.json` is history. Nothing in the shipping composition writes it,
/// so the only supported access is the Module Link importer's read — including
/// the historical `module_folders` spelling an older release wrote.
#[test]
fn the_legacy_profile_file_is_read_only_history() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profiles.json");
    let original = br#"{
            "recent_profile_index": 0,
            "profiles": [{
                "name": "Legacy",
                "workspace_slug": "meml",
                "module_folders": {"module-a": "/src/a"}
            }]
        }"#;
    fs::write(&path, original).unwrap();

    let source = muxed_studio_lib::module_links::legacy_source::locate(directory.path())
        .expect("the live profile file is a supported legacy source");
    let catalog = muxed_studio_lib::module_links::legacy_source::read(&source).unwrap();

    assert_eq!(
        catalog.profiles[0].module_links,
        vec![ModuleLink {
            module_id: "module-a".to_owned(),
            path: "/src/a".to_owned(),
        }]
    );
    // Reading never repairs, rewrites, or migrates the file in place.
    assert_eq!(fs::read(&path).unwrap(), original);
}

/// A malformed legacy file is refused rather than replaced with a default, so
/// the only recoverable copy of a user's configuration is never overwritten.
#[test]
fn a_malformed_legacy_profile_file_is_refused_and_left_intact() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profiles.json");
    fs::write(&path, b"{broken").unwrap();

    let source =
        muxed_studio_lib::module_links::legacy_source::locate(directory.path()).expect("located");
    let error = muxed_studio_lib::module_links::legacy_source::read(&source)
        .expect_err("a malformed profile file cannot be adopted");

    assert_eq!(error.code().as_str(), "module_link_legacy_source_unreadable");
    assert_eq!(fs::read(&path).unwrap(), b"{broken");
}

#[test]
fn readiness_is_one_restartable_fail_closed_result() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("slice2-readiness.json");
    let complete = Slice2Readiness::complete();

    muxed_studio_lib::settings_persistence::publish_readiness(directory.path(), &complete).unwrap();
    muxed_studio_lib::settings_persistence::publish_readiness(directory.path(), &complete).unwrap();
    let persisted: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(persisted["ready"], true);
    assert_eq!(persisted["django_write_fallback"], false);

    let mut partial = complete;
    partial.django_effect_port = false;
    assert!(
        muxed_studio_lib::settings_persistence::publish_readiness(directory.path(), &partial,)
            .is_err()
    );
    let unchanged: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(unchanged["ready"], true);
}
