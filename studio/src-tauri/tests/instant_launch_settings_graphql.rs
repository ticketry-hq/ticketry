use muxed_studio_lib::graphql_foundation::initialize_with_keybinding_settings_and_install;
use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::{TransportApi, TransportApiImpl};

fn request(query: &str, variables: serde_json::Value) -> String {
    serde_json::json!({ "query": query, "variables": variables }).to_string()
}

async fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let foundation_path = directory.path().join("rust-core.sqlite3");
    let settings_path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", settings_path.display()))
        .await
        .unwrap();
    database
        .execute_unprepared(
            r#"CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY (scope, "key")
            );"#,
        )
        .await
        .unwrap();
    database.close().await.unwrap();
    (directory, foundation_path, settings_path)
}

async fn execute(
    api: &TransportApiImpl,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    serde_json::from_str(&api.clone().graphql_execute(request(query, variables)).await).unwrap()
}

#[tokio::test]
async fn instant_settings_round_trip_through_one_fixed_identity_model_write() {
    let (_directory, foundation_path, settings_path) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_keybinding_settings_and_install(&foundation_path, &settings_path, &api)
        .await
        .unwrap();

    let missing = execute(
        &api,
        "query InstantSetting { instant_launch_setting { value } }",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(
        missing["data"]["instant_launch_setting"],
        serde_json::Value::Null
    );

    let updated = execute(
        &api,
        "mutation Save($prompt: String!, $close: Boolean!) { update_instant_launch_setting(initial_prompt: $prompt, auto_close: $close) { scope key value updated_at } }",
        serde_json::json!({
            "prompt": "Keep generated contracts generated.",
            "close": true
        }),
    )
    .await;
    let setting = &updated["data"]["update_instant_launch_setting"];
    assert_eq!(setting["scope"], "host");
    assert_eq!(setting["key"], "instant_launch");
    assert_eq!(
        setting["value"],
        serde_json::json!({
            "initial_prompt": "Keep generated contracts generated.",
            "auto_close": true
        })
    );
    assert!(setting["updated_at"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));

    let loaded = execute(
        &api,
        "query InstantSetting { instant_launch_setting { scope key value updated_at } }",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(loaded["data"]["instant_launch_setting"], *setting);
}

#[tokio::test]
async fn instant_setting_contract_allowlists_only_prompt_and_auto_close() {
    let sdl = muxed_studio_lib::graphql_foundation::generated_schema_sdl()
        .await
        .unwrap();

    assert!(sdl.contains("instant_launch_setting: KeybindingSetting"));
    assert!(sdl.contains(
        "update_instant_launch_setting(initial_prompt: String!, auto_close: Boolean!): KeybindingSetting!"
    ));
    assert!(!sdl.contains("keybindingSettingCreateOne"));
    assert!(!sdl.contains("keybindingSettingCreateBatch"));
    assert!(!sdl.contains("keybindingSettingUpdate"));
    assert!(!sdl.contains("keybindingSettingDelete"));
}

#[tokio::test]
async fn oversized_initial_prompt_is_rejected_before_the_model_write() {
    let (_directory, foundation_path, settings_path) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_keybinding_settings_and_install(&foundation_path, &settings_path, &api)
        .await
        .unwrap();
    let oversized = "x".repeat(
        muxed_studio_lib::settings_persistence::instant_launch::MAX_INITIAL_PROMPT_CHARACTERS + 1,
    );

    let response = execute(
        &api,
        "mutation Save($prompt: String!, $close: Boolean!) { update_instant_launch_setting(initial_prompt: $prompt, auto_close: $close) { value } }",
        serde_json::json!({ "prompt": oversized, "close": false }),
    )
    .await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"],
        "instant_launch_setting_invalid"
    );
    let database = Database::connect(format!("sqlite:{}?mode=rw", settings_path.display()))
        .await
        .unwrap();
    let count = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM app_settings".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(count, 0);
}
