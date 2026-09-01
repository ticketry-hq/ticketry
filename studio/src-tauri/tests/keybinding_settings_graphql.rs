use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::initialize_with_keybinding_settings_and_install;
use ticketry_settings::{AppSetting, AppSettingRepository, SettingKey, SettingScope};

fn request(query: &str, variables: serde_json::Value) -> String {
    serde_json::json!({
        "query": query,
        "variables": variables,
    })
    .to_string()
}

async fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let directory = tempfile::tempdir().expect("create keybinding fixture");
    let foundation_path = directory.path().join("rust-core.sqlite3");
    let settings_path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", settings_path.display()))
        .await
        .expect("open settings fixture");
    database
        .execute_unprepared(
            r#"
            CREATE TABLE app_settings (
                scope varchar NOT NULL,
                "key" varchar NOT NULL,
                value varchar NOT NULL,
                updated_at varchar NOT NULL,
                PRIMARY KEY (scope, "key")
            );
            "#,
        )
        .await
        .expect("create app settings table");
    database.close().await.expect("close settings fixture");
    (directory, foundation_path, settings_path)
}

async fn execute(
    api: &TransportApiImpl,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    serde_json::from_str(&api.clone().graphql_execute(request(query, variables)).await)
        .expect("decode GraphQL response")
}

#[tokio::test]
async fn missing_and_malformed_keybindings_return_null_without_repairing_storage() {
    let (_directory, foundation_path, settings_path) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_keybinding_settings_and_install(&foundation_path, &settings_path, &api)
        .await
        .expect("install keybinding GraphQL");

    let missing = execute(
        &api,
        "query KeybindingSetting { keybinding_setting { scope key value updated_at } }",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(
        missing["data"]["keybinding_setting"],
        serde_json::Value::Null
    );

    let repository = AppSettingRepository::open(&settings_path)
        .await
        .expect("open settings repository");
    repository
        .put(&AppSetting {
            scope: SettingScope::new("host").unwrap(),
            key: SettingKey::new("keybindings").unwrap(),
            value: "{malformed".to_owned(),
            updated_at: "2026-08-12T12:00:00+00:00".to_owned(),
        })
        .await
        .expect("seed malformed keybindings");

    let malformed = execute(
        &api,
        "query KeybindingSetting { keybinding_setting { scope key value updated_at } }",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(
        malformed["data"]["keybinding_setting"],
        serde_json::Value::Null
    );

    let preserved = repository
        .get(
            &SettingScope::new("host").unwrap(),
            &SettingKey::new("keybindings").unwrap(),
        )
        .await
        .expect("read malformed keybindings")
        .expect("malformed row remains");
    assert_eq!(preserved.value, "{malformed");
    assert_eq!(preserved.updated_at, "2026-08-12T12:00:00+00:00");
}

#[tokio::test]
async fn valid_keybindings_round_trip_with_bound_identity_timestamp_and_restart() {
    let (_directory, foundation_path, settings_path) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_keybinding_settings_and_install(&foundation_path, &settings_path, &api)
        .await
        .expect("install keybinding GraphQL");
    let repository = AppSettingRepository::open(&settings_path)
        .await
        .expect("open settings repository");
    repository
        .put(&AppSetting {
            scope: SettingScope::new("host").unwrap(),
            key: SettingKey::new("unrelated").unwrap(),
            value: r#"{"kept":true}"#.to_owned(),
            updated_at: "2026-08-12T12:00:00+00:00".to_owned(),
        })
        .await
        .expect("seed unrelated setting");
    let overrides = serde_json::json!([
        {
            "context": "global",
            "actionId": "settings",
            "chord": {
                "key": ",",
                "alt": false,
                "control": false,
                "meta": true,
                "shift": false
            }
        },
        { "future": { "arbitrary": [true, 7, null] } }
    ]);

    let updated = execute(
        &api,
        "mutation UpdateKeybindingSetting($value: Json!) { update_keybinding_setting(value: $value) { scope key value updated_at } }",
        serde_json::json!({ "value": overrides }),
    )
    .await;
    let setting = &updated["data"]["update_keybinding_setting"];
    assert_eq!(setting["scope"], "host");
    assert_eq!(setting["key"], "keybindings");
    assert_eq!(setting["value"], overrides);
    assert!(setting["updated_at"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    let updated_at = setting["updated_at"].clone();
    let unrelated = repository
        .get(
            &SettingScope::new("host").unwrap(),
            &SettingKey::new("unrelated").unwrap(),
        )
        .await
        .expect("read unrelated setting")
        .expect("unrelated setting remains");
    assert_eq!(unrelated.value, r#"{"kept":true}"#);
    assert_eq!(unrelated.updated_at, "2026-08-12T12:00:00+00:00");

    let restarted_api = TransportApiImpl::new();
    initialize_with_keybinding_settings_and_install(
        &foundation_path,
        &settings_path,
        &restarted_api,
    )
    .await
    .expect("reinstall keybinding GraphQL after restart");
    let restarted = execute(
        &restarted_api,
        "query KeybindingSetting { keybinding_setting { scope key value updated_at } }",
        serde_json::Value::Null,
    )
    .await;
    let persisted = &restarted["data"]["keybinding_setting"];
    assert_eq!(persisted["scope"], "host");
    assert_eq!(persisted["key"], "keybindings");
    assert_eq!(persisted["value"], overrides);
    assert_eq!(persisted["updated_at"], updated_at);
}

#[tokio::test]
async fn mutation_contract_exposes_only_the_json_value_for_the_fixed_setting() {
    let sdl = ticketry_graphql_schema::generated_schema_sdl()
        .await
        .expect("build GraphQL contract");

    assert!(sdl.contains("update_keybinding_setting(value: Json!): KeybindingSetting!"));
    assert!(!sdl.contains("keybindingSettingCreateOne"));
    assert!(!sdl.contains("keybindingSettingCreateBatch"));
    assert!(!sdl.contains("keybindingSettingUpdate"));
    assert!(!sdl.contains("keybindingSettingDelete"));
    assert!(!sdl.contains("KeybindingSettingBasic"));
    assert!(!sdl.contains("KeybindingSettingInsertInput"));
}

#[tokio::test]
async fn storage_failures_are_typed_graphql_errors() {
    let directory = tempfile::tempdir().expect("create unavailable fixture");
    let foundation_path = directory.path().join("rust-core.sqlite3");
    let settings_path = directory.path().join("state.db");
    Database::connect(format!("sqlite:{}?mode=rwc", settings_path.display()))
        .await
        .expect("create schema-less settings database")
        .close()
        .await
        .expect("close schema-less settings database");
    let api = TransportApiImpl::new();
    initialize_with_keybinding_settings_and_install(&foundation_path, &settings_path, &api)
        .await
        .expect("install keybinding GraphQL");

    let read = execute(
        &api,
        "query KeybindingSetting { keybinding_setting { value } }",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(
        read["errors"][0]["extensions"]["code"],
        "settings_storage_failed"
    );

    let write = execute(
        &api,
        "mutation UpdateKeybindingSetting($value: Json!) { update_keybinding_setting(value: $value) { value } }",
        serde_json::json!({ "value": [] }),
    )
    .await;
    assert_eq!(
        write["errors"][0]["extensions"]["code"],
        "settings_storage_failed"
    );
}
