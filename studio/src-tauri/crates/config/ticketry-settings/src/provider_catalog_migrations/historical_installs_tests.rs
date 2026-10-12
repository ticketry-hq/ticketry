use sea_orm::ConnectionTrait;

use super::{
    catalog_registry, catalog_test_database as db, install_provider_catalog_migration,
    provider_catalog_migrations,
};

#[tokio::test]
async fn flash_defers_until_the_reasoning_join_table_exists_then_retries() {
    let (_directory, database) = db::with_codex(&[db::PROVIDER, db::AGENT_MODEL]).await;
    let migration = provider_catalog_migrations()
        .unwrap()
        .iter()
        .find(|migration| migration.step() == 57)
        .expect("flash migration is registered");

    install_provider_catalog_migration(&database, migration)
        .await
        .unwrap();

    assert!(!db::table_exists(&database, catalog_registry::CODEX_GLM_5_3_FLASH.ledger).await);
    assert_eq!(db::model_count(&database).await, 0);
    database
        .execute_unprepared(db::AGENT_MODEL_REASONING_LEVEL)
        .await
        .unwrap();
    install_provider_catalog_migration(&database, migration)
        .await
        .unwrap();
    assert!(db::table_exists(&database, catalog_registry::CODEX_GLM_5_3_FLASH.ledger).await);
    assert_eq!(
        db::reasoning_for(&database, "glm-5.3-flash").await,
        Some(vec![])
    );
}
