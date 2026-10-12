use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, EntityTrait, QueryOrder};
use ticketry_entities::{agent_model, agent_model_reasoning_level, reasoning_level};

use super::{catalog_test_database as db, *};

async fn install(database: &DatabaseConnection, step: u32) -> Result<(), DbErr> {
    let migration = provider_catalog_migrations()?
        .iter()
        .find(|migration| migration.step() == step)
        .expect("historical migration is registered");
    install_provider_catalog_migration(database, migration).await
}

const HISTORICAL: &[(u32, &str, bool)] = &[
    (44, catalog_registry::CODEX_5_6.ledger, false),
    (51, catalog_registry::CODEX_SPARK.ledger, true),
    (54, catalog_registry::CODEX_ASTRA.ledger, false),
    (55, catalog_registry::CODEX_6_ASTRA.ledger, true),
    (57, catalog_registry::CODEX_GLM_5_3_FLASH.ledger, false),
];

#[tokio::test]
async fn historical_missing_provider_policies_preserve_ledger_behavior() {
    for &(step, ledger, skips) in HISTORICAL {
        let (_directory, database) = db::open(db::ALL_TABLES).await;
        let result = install(&database, step).await;
        if skips {
            result.unwrap();
        } else {
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("no codex provider"));
        }
        assert_eq!(
            db::table_exists(&database, ledger).await,
            skips,
            "step {step}"
        );
        assert_eq!(db::model_count(&database).await, 0);
    }
}

#[tokio::test]
async fn astra_rename_preserves_id_using_only_provider_and_model_tables() {
    let (_directory, database) = db::with_codex(&[db::PROVIDER, db::AGENT_MODEL]).await;
    database
        .execute_unprepared(
            "INSERT INTO worktracker_agentmodel (id, provider_id, name) \
         VALUES ('original-id', 'codex-id', 'gpt-5.6-astra')",
        )
        .await
        .unwrap();

    install(&database, 55).await.unwrap();
    install(&database, 55).await.unwrap();

    let model = agent_model::Entity::find_by_id("original-id")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(model.name, "gpt-6-astra");
    assert_eq!(model.provider_id, "codex-id");
    assert_eq!(db::model_count(&database).await, 1);
    assert!(db::table_exists(&database, catalog_registry::CODEX_6_ASTRA.ledger).await);
}

#[tokio::test]
async fn astra_rename_noops_without_provider_or_old_model_and_when_target_exists() {
    // Missing provider and missing old model must still record adoption.
    for has_provider in [false, true] {
        let (_directory, database) = db::open(&[db::PROVIDER, db::AGENT_MODEL]).await;
        if has_provider {
            database
                .execute_unprepared(
                    "INSERT INTO worktracker_provider VALUES ('codex-id', 'codex', 1, 1)",
                )
                .await
                .unwrap();
        }
        install(&database, 55).await.unwrap();
        assert_eq!(db::model_count(&database).await, 0);
        assert!(db::table_exists(&database, catalog_registry::CODEX_6_ASTRA.ledger).await);
    }

    let (_directory, database) = db::with_codex(&[db::PROVIDER, db::AGENT_MODEL]).await;
    database
        .execute_unprepared(
            "INSERT INTO worktracker_agentmodel VALUES \
         ('old-id', 'codex-id', 'gpt-5.6-astra'), \
         ('new-id', 'codex-id', 'gpt-6-astra')",
        )
        .await
        .unwrap();
    let before = models(&database).await;

    install(&database, 55).await.unwrap();

    assert_eq!(models(&database).await, before);
    assert!(db::table_exists(&database, catalog_registry::CODEX_6_ASTRA.ledger).await);
}

#[tokio::test]
async fn spark_and_flash_clear_stale_joins_without_reasoning_table_or_model_replacement() {
    for (step, name, ledger) in [
        (
            51,
            "gpt-5.3-codex-spark",
            catalog_registry::CODEX_SPARK.ledger,
        ),
        (
            57,
            "glm-5.3-flash",
            catalog_registry::CODEX_GLM_5_3_FLASH.ledger,
        ),
    ] {
        let (_directory, database) = db::with_codex(&[
            db::PROVIDER,
            db::AGENT_MODEL,
            db::AGENT_MODEL_REASONING_LEVEL,
        ])
        .await;
        database
            .execute_unprepared(&format!(
                "INSERT INTO worktracker_agentmodel VALUES ('original-id', 'codex-id', '{name}'); \
             INSERT INTO worktracker_agentmodelreasoninglevel \
             (agent_model_id, reasoning_level_id) VALUES ('original-id', 'stale-level-id')",
            ))
            .await
            .unwrap();

        install(&database, step).await.unwrap();

        assert_eq!(
            models(&database).await,
            vec![("original-id".to_owned(), name.to_owned())]
        );
        assert_eq!(db::reasoning_for(&database, name).await, Some(vec![]));
        assert!(db::table_exists(&database, ledger).await);
    }
}

async fn models(database: &DatabaseConnection) -> Vec<(String, String)> {
    agent_model::Entity::find()
        .order_by_asc(agent_model::Column::Name)
        .all(database)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.id, row.name))
        .collect()
}

async fn identities(
    database: &DatabaseConnection,
) -> (Vec<(String, String)>, Vec<String>, Vec<i64>) {
    let levels = reasoning_level::Entity::find()
        .order_by_asc(reasoning_level::Column::Id)
        .all(database)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect();
    let joins = agent_model_reasoning_level::Entity::find()
        .order_by_asc(agent_model_reasoning_level::Column::Id)
        .all(database)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect();
    (models(database).await, levels, joins)
}

#[tokio::test]
async fn generic_installer_preserves_historical_catalog_and_rerun_identities() {
    let (_directory, database) = db::with_codex(db::ALL_TABLES).await;
    for step in [44, 51, 54, 55, 57, 61, 62] {
        install(&database, step).await.unwrap();
    }
    let names: Vec<_> = models(&database)
        .await
        .into_iter()
        .map(|(_, name)| name)
        .collect();
    assert_eq!(
        names,
        [
            "glm-5.3-flash",
            "gpt-5.3-codex-spark",
            "gpt-5.6-luna",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-6-astra",
            "gpt-6-luna",
            "gpt-6-sol",
            "gpt-6.1-sol",
        ]
    );
    for (name, expected) in [
        ("glm-5.3-flash", &[][..]),
        ("gpt-5.3-codex-spark", &[][..]),
        (
            "gpt-5.6-luna",
            &["high", "low", "max", "medium", "xhigh"][..],
        ),
        (
            "gpt-5.6-sol",
            &["high", "low", "max", "medium", "ultra", "xhigh"][..],
        ),
        (
            "gpt-5.6-terra",
            &["high", "low", "max", "medium", "ultra", "xhigh"][..],
        ),
        (
            "gpt-6-astra",
            &["high", "low", "max", "medium", "ultra", "xhigh"][..],
        ),
        (
            "gpt-6-luna",
            &["high", "low", "max", "medium", "none", "xhigh"][..],
        ),
        (
            "gpt-6-sol",
            &["high", "low", "max", "medium", "none", "xhigh"][..],
        ),
        (
            "gpt-6.1-sol",
            &["high", "low", "max", "medium", "ultra", "xhigh"][..],
        ),
    ] {
        assert_eq!(
            db::reasoning_for(&database, name).await,
            Some(expected.iter().map(|name| (*name).to_owned()).collect()),
            "{name}"
        );
    }
    let before = identities(&database).await;
    for step in [44, 51, 54, 55, 57, 61, 62] {
        install(&database, step).await.unwrap();
    }
    assert_eq!(identities(&database).await, before);
}
