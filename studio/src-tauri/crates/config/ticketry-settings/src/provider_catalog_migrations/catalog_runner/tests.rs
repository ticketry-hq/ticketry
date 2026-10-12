use super::run;
use crate::provider_catalog_migrations::catalog_registry::{
    CatalogEntry, CatalogModel, MissingProvider,
};
use crate::provider_catalog_migrations::catalog_test_database::{self as db, ALL_TABLES};

/// The executable "after" picture: a new model is one entry and nothing else.
const NEXT_MODEL: CatalogEntry = CatalogEntry {
    migration_id: "0099_codex_next_model_catalog",
    ledger: "ticketry_codex_next_catalog_migration",
    source_commit: "0123456789abcdef0123456789abcdef01234567",
    step: 99,
    provider: "codex",
    missing_provider: MissingProvider::Fail,
    handler: None,
    models: &[CatalogModel {
        name: "gpt-next",
        reasoning: &["low", "medium", "high"],
    }],
};

#[tokio::test]
async fn a_new_model_entry_applies_through_the_runner_alone() {
    let (_directory, database) = db::with_codex(ALL_TABLES).await;

    run(&database, &NEXT_MODEL).await.unwrap();

    assert_eq!(
        db::reasoning_for(&database, "gpt-next").await,
        Some(vec![
            "high".to_owned(),
            "low".to_owned(),
            "medium".to_owned()
        ])
    );
    assert!(db::table_exists(&database, NEXT_MODEL.ledger).await);
}

async fn ids(database: &sea_orm::DatabaseConnection) -> (Vec<String>, Vec<String>, Vec<i64>) {
    use sea_orm::{EntityTrait, QueryOrder};
    use ticketry_entities::{agent_model, agent_model_reasoning_level, reasoning_level};
    let models = agent_model::Entity::find()
        .order_by_asc(agent_model::Column::Id)
        .all(database)
        .await
        .unwrap();
    let levels = reasoning_level::Entity::find()
        .order_by_asc(reasoning_level::Column::Id)
        .all(database)
        .await
        .unwrap();
    let joins = agent_model_reasoning_level::Entity::find()
        .order_by_asc(agent_model_reasoning_level::Column::Id)
        .all(database)
        .await
        .unwrap();
    (
        models.into_iter().map(|row| row.id).collect(),
        levels.into_iter().map(|row| row.id).collect(),
        joins.into_iter().map(|row| row.id).collect(),
    )
}

#[tokio::test]
async fn applying_an_entry_twice_leaves_ids_and_joins_unchanged() {
    let (_directory, database) = db::with_codex(ALL_TABLES).await;
    run(&database, &NEXT_MODEL).await.unwrap();
    let first = ids(&database).await;

    run(&database, &NEXT_MODEL).await.unwrap();

    assert_eq!(ids(&database).await, first);
    assert_eq!(first.2.len(), 3);
}

#[tokio::test]
async fn reapplying_content_without_a_ledger_keeps_the_model_id() {
    let (_directory, database) = db::with_codex(ALL_TABLES).await;
    run(&database, &NEXT_MODEL).await.unwrap();
    let first = ids(&database).await;
    use sea_orm::ConnectionTrait;
    database
        .execute_unprepared(&format!("DROP TABLE {}", NEXT_MODEL.ledger))
        .await
        .unwrap();

    run(&database, &NEXT_MODEL).await.unwrap();

    assert_eq!(ids(&database).await, first);
}

#[tokio::test]
async fn stale_reasoning_joins_are_removed_and_missing_ones_added() {
    let (_directory, database) = db::with_codex(ALL_TABLES).await;
    use sea_orm::ConnectionTrait;
    database
        .execute_unprepared(
            "INSERT INTO worktracker_agentmodel (id, provider_id, name) \
                 VALUES ('next-id', 'codex-id', 'gpt-next'); \
             INSERT INTO worktracker_reasoninglevel (id, name) \
                 VALUES ('low-id', 'low'), ('ultra-id', 'ultra'); \
             INSERT INTO worktracker_agentmodelreasoninglevel (agent_model_id, reasoning_level_id) \
                 VALUES ('next-id', 'low-id'), ('next-id', 'ultra-id');",
        )
        .await
        .unwrap();

    run(&database, &NEXT_MODEL).await.unwrap();

    assert_eq!(
        db::reasoning_for(&database, "gpt-next").await,
        Some(vec![
            "high".to_owned(),
            "low".to_owned(),
            "medium".to_owned()
        ])
    );
    assert_eq!(db::model_count(&database).await, 1);
}

#[tokio::test]
async fn a_missing_required_table_defers_the_step_without_a_ledger() {
    let (_directory, database) = db::with_codex(&[
        db::PROVIDER,
        db::AGENT_MODEL,
        db::AGENT_MODEL_REASONING_LEVEL,
    ])
    .await;

    run(&database, &NEXT_MODEL).await.unwrap();

    assert!(!db::table_exists(&database, NEXT_MODEL.ledger).await);
    assert_eq!(db::model_count(&database).await, 0);
}

#[tokio::test]
async fn a_model_list_without_reasoning_does_not_need_the_reasoning_table() {
    const NO_REASONING: CatalogEntry = CatalogEntry {
        models: &[CatalogModel {
            name: "gpt-next-flash",
            reasoning: &[],
        }],
        ..NEXT_MODEL
    };
    let (_directory, database) = db::with_codex(&[
        db::PROVIDER,
        db::AGENT_MODEL,
        db::AGENT_MODEL_REASONING_LEVEL,
    ])
    .await;

    run(&database, &NO_REASONING).await.unwrap();

    assert_eq!(
        db::reasoning_for(&database, "gpt-next-flash").await,
        Some(vec![])
    );
    assert!(db::table_exists(&database, NO_REASONING.ledger).await);
}

#[tokio::test]
async fn a_missing_provider_fails_by_default_and_writes_nothing() {
    let (_directory, database) = db::open(ALL_TABLES).await;

    let error = run(&database, &NEXT_MODEL).await.unwrap_err();

    assert!(error
        .to_string()
        .contains("the provider catalog has no codex provider"));
    assert!(!db::table_exists(&database, NEXT_MODEL.ledger).await);
}

#[tokio::test]
async fn a_skipped_missing_provider_still_records_the_ledger() {
    const SKIPPING: CatalogEntry = CatalogEntry {
        missing_provider: MissingProvider::Skip,
        ..NEXT_MODEL
    };
    let (_directory, database) = db::open(ALL_TABLES).await;

    run(&database, &SKIPPING).await.unwrap();

    assert!(db::table_exists(&database, SKIPPING.ledger).await);
    assert_eq!(db::model_count(&database).await, 0);
}

#[tokio::test]
async fn an_existing_ledger_with_other_provenance_fails_clearly() {
    let (_directory, database) = db::with_codex(ALL_TABLES).await;
    run(&database, &NEXT_MODEL).await.unwrap();
    use sea_orm::ConnectionTrait;
    database
        .execute_unprepared(&format!(
            "UPDATE {} SET source_commit = 'ffffffffffffffffffffffffffffffffffffffff'",
            NEXT_MODEL.ledger
        ))
        .await
        .unwrap();

    let error = run(&database, &NEXT_MODEL).await.unwrap_err();

    assert!(error
        .to_string()
        .contains("unsupported catalog migration 0099_codex_next_model_catalog at version 1"));
}

async fn assert_rejected_without_writes(entry: CatalogEntry, reason: &str) {
    let (_directory, database) = db::with_codex(ALL_TABLES).await;

    let error = run(&database, &entry)
        .await
        .expect_err("entry should be rejected");

    assert!(
        error.to_string().contains(reason),
        "expected `{reason}` in `{error}`"
    );
    if !entry.ledger.is_empty() && !entry.ledger.contains(';') {
        assert!(!db::table_exists(&database, entry.ledger).await);
    }
    assert_eq!(db::model_count(&database).await, 0);
}

fn with_models(models: &'static [CatalogModel]) -> CatalogEntry {
    CatalogEntry {
        models,
        ..NEXT_MODEL
    }
}

#[tokio::test]
async fn an_empty_migration_id_is_rejected() {
    assert_rejected_without_writes(
        CatalogEntry {
            migration_id: "",
            ..NEXT_MODEL
        },
        "empty migration id",
    )
    .await;
}

#[tokio::test]
async fn a_ledger_name_outside_the_strict_pattern_is_rejected() {
    for ledger in [
        "ticketry_codex_next_catalog_migration; DROP TABLE worktracker_provider",
        "codex_next_catalog_migration",
        "ticketry_codex_next_migration",
        "ticketry__catalog_migration",
        "ticketry_Codex_catalog_migration",
        "ticketry_codex-next_catalog_migration",
    ] {
        assert_rejected_without_writes(
            CatalogEntry {
                ledger,
                ..NEXT_MODEL
            },
            "invalid ledger table",
        )
        .await;
    }
}

#[tokio::test]
async fn a_source_commit_that_is_not_a_40_hex_sha_is_rejected() {
    for source_commit in [
        "",
        "0123456789abcdef",
        "0123456789abcdef0123456789abcdef0123456g",
        "0123456789abcdef0123456789abcdef012345678",
    ] {
        assert_rejected_without_writes(
            CatalogEntry {
                source_commit,
                ..NEXT_MODEL
            },
            "invalid source commit",
        )
        .await;
    }
}

#[tokio::test]
async fn an_unknown_provider_slug_is_rejected() {
    assert_rejected_without_writes(
        CatalogEntry {
            provider: "openrouter",
            ..NEXT_MODEL
        },
        "unknown provider openrouter",
    )
    .await;
}

#[tokio::test]
async fn blank_untrimmed_or_duplicate_model_names_are_rejected() {
    const BLANK: &[CatalogModel] = &[CatalogModel {
        name: "",
        reasoning: &[],
    }];
    const UNTRIMMED: &[CatalogModel] = &[CatalogModel {
        name: " gpt-next",
        reasoning: &[],
    }];
    const DUPLICATE: &[CatalogModel] = &[
        CatalogModel {
            name: "gpt-next",
            reasoning: &[],
        },
        CatalogModel {
            name: "gpt-next",
            reasoning: &["low"],
        },
    ];
    assert_rejected_without_writes(with_models(BLANK), "blank model name").await;
    assert_rejected_without_writes(with_models(UNTRIMMED), "untrimmed model name").await;
    assert_rejected_without_writes(with_models(DUPLICATE), "duplicate model gpt-next").await;
}

#[tokio::test]
async fn blank_untrimmed_or_duplicate_reasoning_names_are_rejected() {
    const BLANK: &[CatalogModel] = &[CatalogModel {
        name: "gpt-next",
        reasoning: &["low", ""],
    }];
    const UNTRIMMED: &[CatalogModel] = &[CatalogModel {
        name: "gpt-next",
        reasoning: &["low "],
    }];
    const DUPLICATE: &[CatalogModel] = &[CatalogModel {
        name: "gpt-next",
        reasoning: &["low", "high", "low"],
    }];
    assert_rejected_without_writes(with_models(BLANK), "blank reasoning name").await;
    assert_rejected_without_writes(with_models(UNTRIMMED), "untrimmed reasoning name").await;
    assert_rejected_without_writes(with_models(DUPLICATE), "duplicate reasoning low").await;
}
