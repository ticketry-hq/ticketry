use std::collections::BTreeMap;

use sea_orm::{ConnectionTrait, DatabaseConnection};
use ticketry_installation::install_final_schema_migrations;
use ticketry_settings::{
    install_provider_catalog_migration, provider_catalog_migrations, GlobalLaunchDefault,
    ProviderCatalogService, ProviderCatalogUpdate,
};
use ticketry_work_management::open_for_commands;

#[path = "final_schema_migration_chain/support.rs"]
mod support;

async fn model_ids(database: &DatabaseConnection) -> BTreeMap<String, String> {
    ProviderCatalogService::new(database.clone())
        .load()
        .await
        .unwrap()
        .agent_models
        .into_iter()
        .map(|model| (model.name, model.id))
        .collect()
}

#[tokio::test]
async fn historical_catalog_ledger_sets_converge_without_changing_ids_or_default() {
    for present in ["all", "some", "none"] {
        let (directory, database) = support::fixture().await;
        // Reproduce completed, partially upgraded, and untouched historical catalogs.
        for (index, migration) in provider_catalog_migrations().unwrap().iter().enumerate() {
            if present == "all" || (present == "some" && index < 3) {
                install_provider_catalog_migration(&database, migration)
                    .await
                    .unwrap();
            }
        }
        let original_ids = model_ids(&database).await;
        let default = GlobalLaunchDefault {
            provider: "codex".into(),
            profile: None,
            model: Some("gpt-5.4".into()),
            reasoning: Some("high".into()),
        };
        ProviderCatalogService::new(database.clone())
            .update(ProviderCatalogUpdate {
                activated_providers: vec!["codex".into()],
                codex_profiles: vec![],
                global_default: Some(default.clone()),
            })
            .await
            .unwrap();
        install_final_schema_migrations(&database).await.unwrap();
        support::assert_final(&database).await;
        let upgraded_ids = model_ids(&database).await;
        for (name, id) in original_ids {
            // The historical Astra rename preserves its row identity.
            let final_name = if name == "gpt-5.6-astra" {
                "gpt-6-astra"
            } else {
                &name
            };
            assert_eq!(upgraded_ids.get(final_name), Some(&id), "{present}: {name}");
        }
        let before = ProviderCatalogService::new(database.clone())
            .load()
            .await
            .unwrap();
        assert_eq!(before.global_default, Some(default.clone()), "{present}");
        database.close().await.unwrap();

        let reopened = open_for_commands(&directory.path().join("state.db"))
            .await
            .unwrap();
        install_final_schema_migrations(&reopened).await.unwrap();
        support::assert_final(&reopened).await;
        assert_eq!(model_ids(&reopened).await, upgraded_ids, "{present}");
        let after = ProviderCatalogService::new(reopened).load().await.unwrap();
        assert_eq!(after, before, "catalog after reopening: {present}");
        assert_eq!(after.global_default, Some(default), "{present}");
    }
}

#[tokio::test]
async fn catalog_startup_failure_labels_keep_their_historical_step_numbers() {
    for (step, label) in [
        (44, "0044"),
        (51, "0051"),
        (54, "0054"),
        (55, "0055"),
        (57, "0057"),
        (61, "0061"),
        (62, "0062"),
    ] {
        let (_directory, database) = support::fixture().await;
        for migration in provider_catalog_migrations().unwrap() {
            if migration.step() < step {
                install_provider_catalog_migration(&database, migration)
                    .await
                    .unwrap();
            }
        }
        let migration = support::catalog_step(step);
        let before = model_ids(&database).await;
        database
            .execute_unprepared(&format!(
                "CREATE VIEW {} AS SELECT 1",
                migration.ledger_table()
            ))
            .await
            .unwrap();
        let error = install_final_schema_migrations(&database)
            .await
            .expect_err("a conflicting ledger must stop startup");
        assert!(
            error
                .to_string()
                .contains(&format!("final-schema migration {label} failed:")),
            "{error}"
        );
        assert_eq!(model_ids(&database).await, before, "rollback at {label}");
        database
            .execute_unprepared(&format!("DROP VIEW {}", migration.ledger_table()))
            .await
            .unwrap();
        install_final_schema_migrations(&database).await.unwrap();
        support::assert_final(&database).await;
    }
}
