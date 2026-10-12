use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::initialize_with_keybinding_settings_and_install;
use ticketry_settings::{load_global_mcp_setup, GlobalMcpSetupDecision};

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

async fn installed() -> (tempfile::TempDir, std::path::PathBuf, TransportApiImpl) {
    let (directory, foundation_path, settings_path) = fixture().await;
    let api = TransportApiImpl::new();
    initialize_with_keybinding_settings_and_install(&foundation_path, &settings_path, &api)
        .await
        .unwrap();
    (directory, settings_path, api)
}

const SAVE: &str = "mutation Save($decision: String!) { update_global_mcp_setup_setting(decision: $decision) { scope key value updated_at } }";

#[tokio::test]
async fn an_undecided_installation_reads_no_global_mcp_setup_decision() {
    // [CODING-2892 A1] A fresh installation has neither accepted nor skipped setup.
    let (_directory, settings_path, api) = installed().await;

    let missing = execute(
        &api,
        "query Setup { global_mcp_setup_setting { value } }",
        serde_json::Value::Null,
    )
    .await;

    assert_eq!(
        missing["data"]["global_mcp_setup_setting"],
        serde_json::Value::Null
    );
    let database = Database::connect(format!("sqlite:{}?mode=rw", settings_path.display()))
        .await
        .unwrap();
    assert_eq!(load_global_mcp_setup(&database).await.unwrap(), None);
}

#[tokio::test]
async fn accepted_and_skipped_decisions_round_trip_and_reach_startup() {
    // [CODING-2892 A2] The persisted decision is the one desktop startup reads.
    let (_directory, settings_path, api) = installed().await;
    let database = Database::connect(format!("sqlite:{}?mode=rw", settings_path.display()))
        .await
        .unwrap();

    let skipped = execute(&api, SAVE, serde_json::json!({ "decision": "skipped" })).await;
    let setting = &skipped["data"]["update_global_mcp_setup_setting"];
    assert_eq!(setting["scope"], "host");
    assert_eq!(setting["key"], "global_mcp_setup");
    assert_eq!(setting["value"], serde_json::json!({ "decision": "skipped" }));
    assert_eq!(
        load_global_mcp_setup(&database).await.unwrap(),
        Some(GlobalMcpSetupDecision::Skipped)
    );

    let accepted = execute(&api, SAVE, serde_json::json!({ "decision": "accepted" })).await;
    let setting = &accepted["data"]["update_global_mcp_setup_setting"];
    assert_eq!(setting["value"], serde_json::json!({ "decision": "accepted" }));
    let loaded = execute(
        &api,
        "query Setup { global_mcp_setup_setting { scope key value updated_at } }",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(loaded["data"]["global_mcp_setup_setting"], *setting);
    assert_eq!(
        load_global_mcp_setup(&database).await.unwrap(),
        Some(GlobalMcpSetupDecision::Accepted)
    );
}

#[tokio::test]
async fn an_unknown_decision_is_rejected_before_the_model_write() {
    // [CODING-2892 A3] Only accepted or skipped can be recorded.
    let (_directory, settings_path, api) = installed().await;

    let response = execute(&api, SAVE, serde_json::json!({ "decision": "maybe" })).await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"],
        "global_mcp_setup_setting_invalid"
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

#[tokio::test]
async fn global_mcp_setup_contract_allowlists_only_the_decision() {
    let sdl = ticketry_graphql_schema::generated_schema_sdl()
        .await
        .unwrap();

    assert!(sdl.contains("global_mcp_setup_setting: KeybindingSetting"));
    assert!(sdl.contains(
        "update_global_mcp_setup_setting(decision: String!): KeybindingSetting!"
    ));
}
