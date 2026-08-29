use muxed_studio_lib::settings_persistence::{
    GlobalLaunchDefault, ProviderCatalogService, ProviderCatalogUpdate,
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use tauri_graphql::{TransportApi, TransportApiImpl};

const CLAUDE: &str = "10000000000000000000000000000001";
const AGY: &str = "10000000000000000000000000000002";
const CODEX: &str = "10000000000000000000000000000003";
const GEMINI: &str = "10000000000000000000000000000004";
const OPUS: &str = "20000000000000000000000000000001";
const GPT: &str = "20000000000000000000000000000002";
const MINI: &str = "20000000000000000000000000000003";
const GEMINI_PRO: &str = "20000000000000000000000000000004";
const HIGH: &str = "30000000000000000000000000000001";
const LOW: &str = "30000000000000000000000000000002";

async fn fixture(setting: Option<&str>) -> (tempfile::TempDir, DatabaseConnection) {
    let directory = tempfile::tempdir().expect("create provider catalog fixture");
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open provider catalog fixture");
    database
        .execute_unprepared(&format!(
            r#"
            PRAGMA foreign_keys=ON;
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
                id char(32) PRIMARY KEY, slug varchar(64) NOT NULL UNIQUE,
                name varchar(255) NOT NULL, description text NOT NULL,
                seq_counter integer NOT NULL, state_revision bigint NOT NULL,
                manual_module_order bool NOT NULL, onboarding_required bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_reasoninglevel (
                id char(32) PRIMARY KEY, name varchar(32) NOT NULL UNIQUE
            );
            CREATE TABLE worktracker_agentmodel (
                id char(32) PRIMARY KEY, provider_id char(32) NOT NULL,
                name varchar(255) NOT NULL,
                UNIQUE(provider_id, name),
                FOREIGN KEY(provider_id) REFERENCES worktracker_provider(id)
            );
            CREATE TABLE worktracker_agentmodelreasoninglevel (
                id integer PRIMARY KEY AUTOINCREMENT,
                agent_model_id char(32) NOT NULL,
                reasoning_level_id char(32) NOT NULL,
                UNIQUE(agent_model_id, reasoning_level_id),
                FOREIGN KEY(agent_model_id) REFERENCES worktracker_agentmodel(id),
                FOREIGN KEY(reasoning_level_id) REFERENCES worktracker_reasoninglevel(id)
            );
            INSERT INTO worktracker_provider VALUES
                ('{CLAUDE}', 'claude', 1, 1),
                ('{AGY}', 'agy', 0, 1),
                ('{CODEX}', 'codex', 1, 1),
                ('{GEMINI}', 'gemini', 1, 1);
            INSERT INTO worktracker_reasoninglevel VALUES
                ('{HIGH}', 'high'), ('{LOW}', 'low');
            INSERT INTO worktracker_agentmodel VALUES
                ('{OPUS}', '{CLAUDE}', 'opus'),
                ('{GPT}', '{CODEX}', 'gpt-5.4'),
                ('{MINI}', '{CODEX}', 'gpt-mini'),
                ('{GEMINI_PRO}', '{GEMINI}', 'gemini-pro');
            INSERT INTO worktracker_agentmodelreasoninglevel
                (agent_model_id, reasoning_level_id) VALUES
                ('{OPUS}', '{HIGH}'), ('{OPUS}', '{LOW}'),
                ('{GPT}', '{HIGH}'), ('{MINI}', '{LOW}');
            "#
        ))
        .await
        .expect("create provider catalog schema");
    if let Some(setting) = setting {
        database
            .execute_unprepared(&format!(
                "INSERT INTO app_settings VALUES ('host', 'provider_catalog', {}, '2026-08-12T00:00:00+00:00')",
                sql_string(setting)
            ))
            .await
            .expect("seed provider catalog setting");
    }
    (directory, database)
}

fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn update(
    activated: &[&str],
    provider: Option<&str>,
    model: Option<&str>,
    reasoning: Option<&str>,
) -> ProviderCatalogUpdate {
    ProviderCatalogUpdate {
        activated_providers: activated.iter().map(|value| (*value).to_owned()).collect(),
        global_default: provider.map(|provider| GlobalLaunchDefault {
            provider: provider.to_owned(),
            model: model.map(str::to_owned),
            reasoning: reasoning.map(str::to_owned),
        }),
    }
}

async fn activation(database: &DatabaseConnection) -> Vec<(String, bool)> {
    database
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT slug, activated FROM worktracker_provider ORDER BY slug".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "slug").unwrap(),
                row.try_get("", "activated").unwrap(),
            )
        })
        .collect()
}

#[tokio::test]
async fn existing_rows_keep_stable_ids_compatibility_and_deterministic_order() {
    let (_directory, database) = fixture(None).await;
    let service = ProviderCatalogService::open(database).await.unwrap();

    let catalog = service.load().await.unwrap();

    assert_eq!(
        catalog
            .providers
            .iter()
            .map(|row| row.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["claude", "codex", "gemini"]
    );
    assert_eq!(catalog.providers[1].id, CODEX);
    assert_eq!(
        catalog
            .agent_models
            .iter()
            .map(|row| row.name.as_str())
            .collect::<Vec<_>>(),
        vec!["opus", "gpt-5.4", "gpt-mini", "gemini-pro"]
    );
    assert_eq!(catalog.agent_models[1].id, GPT);
    assert_eq!(
        catalog
            .reasoning_levels
            .iter()
            .map(|row| row.name.as_str())
            .collect::<Vec<_>>(),
        vec!["high", "low"]
    );
}

#[tokio::test]
async fn startup_guard_reports_drift_in_both_directions() {
    let (_directory, database) = fixture(None).await;
    database
        .execute_unprepared("DELETE FROM worktracker_provider WHERE slug = 'agy'")
        .await
        .unwrap();
    let error = ProviderCatalogService::open(database.clone())
        .await
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("adapters without Provider rows: agy"));

    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_provider VALUES ('{AGY}', 'agy', 0, 1); INSERT INTO worktracker_provider VALUES ('40000000000000000000000000000001', 'future', 0, 0);"
        ))
        .await
        .unwrap();
    let error = ProviderCatalogService::open(database).await.unwrap_err();
    assert!(error
        .to_string()
        .contains("Provider rows without adapters: future"));
}

#[tokio::test]
async fn malformed_default_salvages_without_repair_and_valid_default_survives_restart() {
    let (directory, database) = fixture(Some("not json")).await;
    let service = ProviderCatalogService::open(database.clone())
        .await
        .unwrap();
    assert_eq!(service.load().await.unwrap().global_default, None);
    let raw = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT value FROM app_settings".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<String>("", "value")
        .unwrap();
    assert_eq!(raw, "not json");

    service
        .update(update(
            &["codex"],
            Some("codex"),
            Some("gpt-5.4"),
            Some("high"),
        ))
        .await
        .unwrap();
    database.close().await.unwrap();
    let reopened = Database::connect(format!(
        "sqlite:{}?mode=rw",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    let catalog = ProviderCatalogService::open(reopened)
        .await
        .unwrap()
        .load()
        .await
        .unwrap();
    assert_eq!(
        catalog
            .providers
            .iter()
            .map(|row| row.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["codex"]
    );
    assert_eq!(
        catalog.global_default.unwrap().reasoning.as_deref(),
        Some("high")
    );
}

#[tokio::test]
async fn invalid_updates_reject_without_partial_activation_changes() {
    let (_directory, database) = fixture(None).await;
    let service = ProviderCatalogService::open(database.clone())
        .await
        .unwrap();
    let before = activation(&database).await;
    let invalid = [
        update(&["codex", "future"], None, None, None),
        update(&["claude"], Some("codex"), Some("gpt-5.4"), None),
        update(&["codex"], Some("codex"), Some("opus"), None),
        update(&["codex"], Some("codex"), None, Some("high")),
        update(&["codex"], Some("codex"), Some("gpt-mini"), Some("high")),
    ];
    for candidate in invalid {
        let error = service
            .update(candidate)
            .await
            .expect_err("reject invalid update");
        assert_eq!(error.code(), "provider_catalog_validation");
        assert_eq!(activation(&database).await, before);
        assert!(database
            .query_one_raw(sea_orm::Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                "SELECT value FROM app_settings".to_owned(),
            ))
            .await
            .unwrap()
            .is_none());
    }
}

#[tokio::test]
async fn setting_write_failure_rolls_back_provider_activation() {
    let (_directory, database) = fixture(None).await;
    let service = ProviderCatalogService::open(database.clone())
        .await
        .unwrap();
    let before = activation(&database).await;
    database
        .execute_unprepared(
            "CREATE TRIGGER reject_provider_setting BEFORE INSERT ON app_settings BEGIN SELECT RAISE(ABORT, 'injected setting failure'); END;",
        )
        .await
        .unwrap();

    let error = service
        .update(update(&["codex"], None, None, None))
        .await
        .expect_err("inject settings failure");

    assert_eq!(error.code(), "provider_catalog_storage_failed");
    assert_eq!(activation(&database).await, before);
}

#[tokio::test]
async fn generated_graphql_query_and_restricted_mutation_use_the_catalog_service() {
    let (directory, database) = fixture(None).await;
    database.close().await.unwrap();
    let api = TransportApiImpl::new();
    muxed_studio_lib::graphql_foundation::initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &directory.path().join("state.db"),
        &directory.path().join("media"),
        &api,
    )
    .await
    .expect("install provider catalog GraphQL");

    let response: serde_json::Value = serde_json::from_str(
        &api.graphql_execute(
            serde_json::json!({
                "query": r#"
                    mutation UpdateProviderCatalog(
                      $activatedProviders: [String!]!,
                      $defaultProvider: String,
                      $defaultModel: String,
                      $defaultReasoning: String
                    ) {
                      update_provider_catalog(
                        activated_providers: $activatedProviders,
                        default_provider: $defaultProvider,
                        default_model: $defaultModel,
                        default_reasoning: $defaultReasoning
                      ) {
                        providers { slug activated }
                        agent_models {
                          name
                          reasoning_levels: agentModelReasoningLevel {
                            nodes { reasoning_level_id: reasoningLevelId }
                          }
                        }
                        global_default { provider model reasoning }
                      }
                    }
                "#,
                "variables": {
                    "activatedProviders": ["codex"],
                    "defaultProvider": "codex",
                    "defaultModel": "gpt-5.4",
                    "defaultReasoning": "high"
                }
            })
            .to_string(),
        )
        .await,
    )
    .expect("decode provider catalog GraphQL response");

    assert!(response.get("errors").is_none(), "{response:#}");
    assert_eq!(
        response["data"]["update_provider_catalog"]["providers"],
        serde_json::json!([{"slug": "codex", "activated": true}])
    );
    assert_eq!(
        response["data"]["update_provider_catalog"]["global_default"],
        serde_json::json!({
            "provider": "codex",
            "model": "gpt-5.4",
            "reasoning": "high"
        })
    );
    assert_eq!(
        response["data"]["update_provider_catalog"]["agent_models"][1]["reasoning_levels"]["nodes"]
            [0]["reasoning_level_id"],
        "30000000-0000-0000-0000-000000000001"
    );
}
