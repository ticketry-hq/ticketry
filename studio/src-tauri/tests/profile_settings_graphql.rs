use std::fs;

use muxed_studio_lib::graphql_foundation::initialize_with_profile_settings_and_install;
use muxed_studio_lib::settings_persistence::SettingsStores;
use tauri_graphql::{TransportApi, TransportApiImpl};

const SETTINGS_FIELDS: &str = r#"
    recent_profile_index
    profiles {
      name workspace_slug agent_prompt agent_prompts
      module_links { module_id path }
      recent_project_id recent_module_ids
    }
    features { sidebar projects }
"#;

fn request(query: &str, variables: serde_json::Value) -> String {
    serde_json::json!({ "query": query, "variables": variables }).to_string()
}

async fn execute(
    api: &TransportApiImpl,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    serde_json::from_str(&api.clone().graphql_execute(request(query, variables)).await)
        .expect("decode GraphQL response")
}

async fn install(directory: &tempfile::TempDir) -> TransportApiImpl {
    let api = TransportApiImpl::new();
    initialize_with_profile_settings_and_install(
        &directory.path().join("rust-core.sqlite3"),
        directory.path(),
        &api,
    )
    .await
    .expect("install profile settings endpoint");
    api
}

#[tokio::test]
async fn profile_crud_reconciles_recent_index_and_rejects_out_of_range() {
    let directory = tempfile::tempdir().unwrap();
    let api = install(&directory).await;

    let empty_error = execute(
        &api,
        "mutation { select_local_profile(index: 0) { recent_profile_index } }",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        empty_error["errors"][0]["extensions"]["code"],
        "index_out_of_range"
    );

    for name in ["First", "Second", "Third"] {
        let response = execute(
            &api,
            &format!(
                "mutation($profile: LocalProfileInput!) {{ add_local_profile(profile: $profile) {{ {SETTINGS_FIELDS} }} }}"
            ),
            serde_json::json!({
                "profile": { "name": name, "workspace_slug": "meml" }
            }),
        )
        .await;
        assert!(response.get("errors").is_none(), "{response:#}");
    }

    execute(
        &api,
        "mutation { select_local_profile(index: 2) { recent_profile_index } }",
        serde_json::json!({}),
    )
    .await;
    let shifted = execute(
        &api,
        &format!("mutation {{ delete_local_profile(index: 0) {{ {SETTINGS_FIELDS} }} }}"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        shifted["data"]["delete_local_profile"]["recent_profile_index"],
        1
    );

    let selected_deleted = execute(
        &api,
        &format!("mutation {{ delete_local_profile(index: 1) {{ {SETTINGS_FIELDS} }} }}"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        selected_deleted["data"]["delete_local_profile"]["recent_profile_index"],
        0
    );
    assert_eq!(
        selected_deleted["data"]["delete_local_profile"]["profiles"][0]["name"],
        "Second"
    );

    let error = execute(
        &api,
        "mutation { delete_local_profile(index: -1) { recent_profile_index } }",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        error["errors"][0]["extensions"]["code"],
        "index_out_of_range"
    );
}

#[tokio::test]
async fn legacy_links_full_profile_shape_and_features_survive_restart() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(
        directory.path().join("profiles.json"),
        r#"{
          "recent_profile_index": 0,
          "profiles": [{
            "name": "Legacy",
            "workspace_slug": "meml",
            "agent_prompt": "Focused",
            "agent_prompts": {"codex": "Test first"},
            "module_folders": {"module-a": "/src/a"},
            "recent_project_id": "project-a",
            "recent_module_ids": {"project-a": "module-a"}
          }]
        }"#,
    )
    .unwrap();
    fs::write(
        directory.path().join("features.json"),
        r#"{"sidebar":true,"projects":true}"#,
    )
    .unwrap();
    let api = install(&directory).await;

    let loaded = execute(
        &api,
        &format!("query {{ local_settings {{ {SETTINGS_FIELDS} }} }}"),
        serde_json::json!({}),
    )
    .await;
    let settings = &loaded["data"]["local_settings"];
    assert_eq!(settings["profiles"][0]["module_links"][0]["path"], "/src/a");
    assert_eq!(
        settings["profiles"][0]["agent_prompts"]["codex"],
        "Test first"
    );
    assert_eq!(settings["profiles"][0]["recent_project_id"], "project-a");
    assert_eq!(settings["features"]["projects"], true);

    let replaced = execute(
        &api,
        &format!(
            "mutation($profile: LocalProfileInput!) {{ replace_local_profile(index: 0, profile: $profile) {{ {SETTINGS_FIELDS} }} }}"
        ),
        serde_json::json!({
          "profile": {
            "name": "Current",
            "workspace_slug": "meml",
            "agent_prompt": "Focused",
            "agent_prompts": {"codex": "Test first"},
            "module_links": [{"module_id": "module-a", "path": "/src/current"}],
            "recent_project_id": "project-a",
            "recent_module_ids": {"project-a": "module-a"}
          }
        }),
    )
    .await;
    assert!(replaced.get("errors").is_none(), "{replaced:#}");

    let normalized = execute(
        &api,
        &format!(
            "mutation {{ replace_feature_flags(features: {{sidebar: false, projects: true}}) {{ {SETTINGS_FIELDS} }} }}"
        ),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(
        normalized["data"]["replace_feature_flags"]["features"]["sidebar"],
        false
    );
    assert_eq!(
        normalized["data"]["replace_feature_flags"]["features"]["projects"],
        false
    );
    let invalid = execute(
        &api,
        "mutation($features: LocalFeatureFlagsInput!) { replace_feature_flags(features: $features) { recent_profile_index } }",
        serde_json::json!({"features": {"sidebar": "yes", "projects": true}}),
    )
    .await;
    assert!(invalid["errors"].is_array());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(
            &fs::read_to_string(directory.path().join("features.json")).unwrap()
        )
        .unwrap(),
        serde_json::json!({"sidebar": false, "projects": false})
    );

    drop(api);
    let restarted = install(&directory).await;
    let reloaded = execute(
        &restarted,
        &format!("query {{ local_settings {{ {SETTINGS_FIELDS} }} }}"),
        serde_json::json!({}),
    )
    .await;
    let profile = &reloaded["data"]["local_settings"]["profiles"][0];
    assert_eq!(profile["name"], "Current");
    assert_eq!(profile["module_links"][0]["path"], "/src/current");
    assert_eq!(profile["recent_module_ids"]["project-a"], "module-a");
    assert!(!fs::read_to_string(directory.path().join("profiles.json"))
        .unwrap()
        .contains("module_folders"));
}

#[test]
fn implicit_local_profile_is_created_once_by_rust() {
    let directory = tempfile::tempdir().unwrap();
    let stores = SettingsStores::new(directory.path());

    stores.ensure_local_profile("Local", "meml").unwrap();
    stores.ensure_local_profile("Ignored", "other").unwrap();

    let stored: serde_json::Value =
        serde_json::from_slice(&fs::read(directory.path().join("profiles.json")).unwrap()).unwrap();
    assert_eq!(stored["recent_profile_index"], 0);
    assert_eq!(stored["profiles"].as_array().unwrap().len(), 1);
    assert_eq!(stored["profiles"][0]["name"], "Local");
    assert_eq!(stored["profiles"][0]["workspace_slug"], "meml");
}
