use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use ticketry_entities::agent_model;
use ticketry_installation::install_final_schema_migrations;
use ticketry_settings::{
    install_codex_6_1_sol, GlobalLaunchDefault, ProviderCatalogService, ProviderCatalogUpdate,
    CODEX_6_1_SOL_LEDGER,
};

#[path = "final_schema_migration_chain/support.rs"]
mod support;

#[tokio::test]
async fn codex_6_1_default_and_model_identity_survive_reopening() {
    let (directory, database) = support::fixture().await;
    install_final_schema_migrations(&database).await.unwrap();
    support::assert_final(&database).await;
    let model = agent_model::Entity::find()
        .filter(agent_model::Column::Name.eq("gpt-6.1-sol"))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let default = GlobalLaunchDefault {
        provider: "codex".into(),
        profile: None,
        model: Some(model.name.clone()),
        reasoning: Some("ultra".into()),
    };
    let service = ProviderCatalogService::new(database.clone());
    let saved = service
        .update(ProviderCatalogUpdate {
            activated_providers: vec!["codex".into()],
            codex_profiles: vec![],
            global_default: Some(default.clone()),
        })
        .await
        .unwrap();
    assert_eq!(saved.global_default, Some(default.clone()));
    drop(service);
    database.close().await.unwrap();

    let reopened = ticketry_work_management::open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    install_final_schema_migrations(&reopened).await.unwrap();
    let catalog = ProviderCatalogService::new(reopened).load().await.unwrap();
    assert_eq!(catalog.global_default, Some(default));
    let models = catalog
        .agent_models
        .iter()
        .filter(|row| row.name == "gpt-6.1-sol")
        .collect::<Vec<_>>();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, model.id);
}

#[tokio::test]
async fn codex_6_1_failure_rolls_back_and_can_retry() {
    let (_directory, database) = support::fixture().await;
    database
        .execute_unprepared(
            "CREATE TRIGGER refuse_reasoning BEFORE INSERT ON worktracker_agentmodelreasoninglevel
             BEGIN SELECT RAISE(ABORT, 'reasoning unavailable'); END",
        )
        .await
        .unwrap();
    assert!(install_codex_6_1_sol(&database).await.is_err());
    assert!(!support::table_exists(&database, CODEX_6_1_SOL_LEDGER).await);
    assert!(agent_model::Entity::find()
        .filter(agent_model::Column::Name.eq("gpt-6.1-sol"))
        .one(&database)
        .await
        .unwrap()
        .is_none());

    database
        .execute_unprepared("DROP TRIGGER refuse_reasoning")
        .await
        .unwrap();
    install_codex_6_1_sol(&database).await.unwrap();
    assert!(support::table_exists(&database, CODEX_6_1_SOL_LEDGER).await);
}
